import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import fsk from "../../acoustic/fsk";
import receiverModule from "../../acoustic/receiver";
import { createAudioContext, levelDb, openMic } from "../../acoustic/mic";
import slotsModule from "../../acoustic/slots";
import { serverToContextTime, syncServerClock } from "../../acoustic/clock";
import { createTransmitter } from "../../acoustic/transmitter";
import { keepScreenOn } from "../../acoustic/wakeLock";
import { signDeviceChallenge } from "../../utils/deviceKey";
import AppShell from "../../ui/AppShell";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import { PageLoader, Spinner } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { untilLabel } from "../../utils/lockTime";
import { decisionText, explain, queryReasonLabel } from "./attendanceText";
import "../checkin.css";

// The AWS liveness component is large: load it only when the face step starts.
const FaceCheck = lazy(() => import("../face/FaceCheck"));
const QuerySheet = lazy(() => import("./QuerySheet"));

const { FrameReceiver } = receiverModule;
const { upcomingSlots } = slotsModule;
const requestConfig = { withCredentials: true };
const SCAN_MS = 500;
const STATUS_POLL_MS = 5000;
const HINT_AFTER_MS = 60 * 1000;
const RELAY_TIMEOUT_MS = 12 * 1000;

const STEPS = ["Hear key", "Face check", "Help classmates", "Done"];
const STEP_OF = {
  ready: 0, listening: 0, submitting: 0,
  "face-intro": 1, face: 1, "face-checking": 1, "face-retry": 1,
  relaying: 2,
  done: 3,
};


const formatClock = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// Final screen for a /me response, or null while the student can still act.
const settledState = (data) => {
  const record = data.record;
  if (record && ["present", "review", "absent"].includes(record.status)) return "done";
  if (record?.status === "heard") {
    const graceOver = data.session.status !== "open" && data.session.faceGraceEndsAt && Date.now() > new Date(data.session.faceGraceEndsAt).getTime();
    return graceOver ? "done" : null;
  }
  return data.session.status !== "open" ? "done" : null;
};

const CheckIn = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [user, setUser] = useState(null);
  const [info, setInfo] = useState(null); // /me response
  const [state, setState] = useState("loading");
  const [errorText, setErrorText] = useState("");
  const [faceResult, setFaceResult] = useState(null);
  const [relayed, setRelayed] = useState(false);
  const [level, setLevel] = useState(null);
  const [listeningSince, setListeningSince] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [querying, setQuerying] = useState(false);

  const audioRef = useRef({});
  const receiverRef = useRef(null);
  const levelRef = useRef(null);
  const timersRef = useRef([]);
  const triedKeysRef = useRef(new Set());
  const busyRef = useRef(false); // a claim / face submit / relay is running
  const clockRef = useRef({ offsetMs: 0 });
  const profileRef = useRef(fsk.PROFILES.mid);

  const stopTimers = () => {
    timersRef.current.forEach((timer) => window.clearInterval(timer));
    timersRef.current = [];
  };

  const stopMic = async () => {
    receiverRef.current = null;
    const mic = audioRef.current.mic;
    audioRef.current.mic = null;
    await mic?.stop();
  };

  const stopEverything = useCallback(async () => {
    timersRef.current.forEach((timer) => window.clearInterval(timer));
    timersRef.current = [];
    receiverRef.current = null;
    const audio = audioRef.current;
    audioRef.current = {};
    audio.transmitter?.stop();
    await audio.wakeLock?.release();
    await audio.mic?.stop();
    if (audio.relayContext) await audio.relayContext.close().catch(() => {});
  }, []);

  useEffect(() => () => {
    stopEverything();
  }, [stopEverything]);

  // Countdown ticker for the window / face grace.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadStatus = useCallback(async () => {
    const response = await axios.get(`${SERVER_URL}/sessions/${sessionId}/me`, requestConfig);
    setInfo(response.data);
    return response.data;
  }, [sessionId]);

  const finish = useCallback(async () => {
    await stopEverything();
    await loadStatus().catch(() => null);
    setState("done");
  }, [stopEverything, loadStatus]);

  useEffect(() => {
    axios
      .get(`${SERVER_URL}/islogin`, requestConfig)
      .then(async (response) => {
        if (response.data.user.role !== "student") {
          navigate("/teacher-dashboard");
          return;
        }
        setUser(response.data.user);
        const data = await loadStatus();
        if (settledState(data)) return setState("done");
        if (data.session.faceRequired && !data.identityVerified) return setState("identity");
        if (data.record?.status === "heard") return setState("face-intro"); // page reloaded after hearing
        return setState("ready");
      })
      .catch((requestError) => {
        if (requestError.response?.status === 401) navigate("/login");
        else {
          setErrorText(requestError.response?.data?.message || "Could not load this check-in.");
          setState("error");
        }
      });
  }, [navigate, loadStatus]);

  // ----- relay (help classmates) -----
  const playRelay = async () => {
    setState("relaying");
    try {
      const response = await axios.post(`${SERVER_URL}/sessions/${sessionId}/relay`, {}, requestConfig);
      const relay = response.data.relay;
      if (!relay) return;
      await stopMic(); // Android can lower playback while the mic is open
      const context = await createAudioContext();
      audioRef.current.relayContext = context;
      const transmitter = createTransmitter(context);
      audioRef.current.transmitter = transmitter;
      transmitter.setFrame({ value: relay.value, profile: fsk.PROFILES[relay.profile] || profileRef.current });
      const offsetMs = clockRef.current.offsetMs;
      const serverNow = Date.now() + offsetMs;
      const slots = upcomingSlots(relay.playAt, serverNow, relay.slotMs || 2000, relay.playAt.length || 3);
      const times = slots.map((serverMs) => serverToContextTime(context, serverMs, offsetMs));
      const waitMs = Math.min(RELAY_TIMEOUT_MS, slots[slots.length - 1] - serverNow + 3000);
      const played = await Promise.race([transmitter.playAt(times), new Promise((resolve) => window.setTimeout(() => resolve(0), waitMs))]);
      setRelayed(played > 0);
    } catch {
      // Relaying only helps classmates; this student's record is already decided.
    }
  };

  const afterFaceStep = async () => {
    busyRef.current = true;
    await playRelay();
    busyRef.current = false;
    await finish();
  };

  // ----- face step -----
  const submitFace = async (livenessSessionId) => {
    busyRef.current = true;
    setState("face-checking");
    try {
      const proof = await signDeviceChallenge({ purpose: "face", payload: { livenessSessionId } });
      const response = await axios.post(`${SERVER_URL}/sessions/${sessionId}/face`, { livenessSessionId, ...proof }, requestConfig);
      setFaceResult(response.data);
      busyRef.current = false;
      if (response.data.face.retryAllowed) {
        setState("face-retry");
        return;
      }
      if (response.data.face.status === "passed") toast("Face confirmed — you're present.", "success");
      await afterFaceStep();
    } catch (requestError) {
      busyRef.current = false;
      const status = requestError.response?.status;
      if (status === 401) {
        await stopEverything();
        setState("device");
      } else if (status === 409) {
        await finish();
      } else {
        setErrorText(requestError.response?.data?.message || requestError.message || "Could not submit the face check.");
        setState("face-intro");
      }
    }
  };

  const skipFace = async () => {
    busyRef.current = true;
    try {
      await axios.post(`${SERVER_URL}/sessions/${sessionId}/face/skip`, {}, requestConfig);
    } catch {
      // the grace timer settles it anyway
    }
    await afterFaceStep();
  };

  // ----- hearing the key -----
  const claim = async (key) => {
    busyRef.current = true;
    setState("submitting");
    try {
      const proof = await signDeviceChallenge({ purpose: "claim", payload: { sessionId, key } });
      const response = await axios.post(`${SERVER_URL}/sessions/${sessionId}/claims`, { key, ...proof }, requestConfig);
      stopTimers();
      await stopMic();
      busyRef.current = false;
      if (response.data.status === "heard") {
        setState("face-intro");
        return;
      }
      // Sound-only check-in (or already decided): relay if offered, then done.
      if (response.data.relay) await afterFaceStep();
      else await finish();
    } catch (requestError) {
      busyRef.current = false;
      const status = requestError.response?.status;
      const code = requestError.response?.data?.code;
      if (status === 400) {
        setState("listening"); // not this session's key (e.g. a nearby class); keep listening
      } else if (status === 401) {
        await stopEverything();
        setState("device");
      } else if (status === 403 && code === "not_enrolled") {
        await stopEverything();
        setState("identity");
      } else if (status === 409) {
        await finish();
      } else {
        triedKeysRef.current.delete(key); // network hiccup: allow this key to be retried
        setState("listening");
      }
    }
  };

  const join = async () => {
    setErrorText("");
    try {
      const joinResponse = await axios.post(`${SERVER_URL}/sessions/${sessionId}/join`, {}, requestConfig);
      profileRef.current = fsk.PROFILES[joinResponse.data.session.profile] || fsk.PROFILES.mid;
      // Server clock for relay timing; a failure only makes relays less aligned.
      clockRef.current = (await syncServerClock(async () => (await axios.get(`${SERVER_URL}/time`)).data.now).catch(() => null)) || { offsetMs: 0 };
      audioRef.current.wakeLock = await keepScreenOn();
      if (joinResponse.data.record.status === "heard") {
        setState("face-intro");
        return;
      }
      const mic = await openMic({
        onChunk: (chunk) => {
          receiverRef.current?.push(chunk);
          levelRef.current = levelDb(chunk);
        },
      });
      audioRef.current.mic = mic;
      receiverRef.current = new FrameReceiver({ sampleRate: mic.sampleRate, profile: profileRef.current });
      setListeningSince(Date.now());
      setState("listening");

      timersRef.current.push(window.setInterval(() => {
        setLevel(levelRef.current);
        const frames = receiverRef.current?.scan() || [];
        const fresh = frames.find((frame) => !triedKeysRef.current.has(frame.value));
        if (fresh && !busyRef.current) {
          triedKeysRef.current.add(fresh.value);
          claim(fresh.value);
        }
      }, SCAN_MS));

      timersRef.current.push(window.setInterval(async () => {
        if (busyRef.current) return;
        const data = await loadStatus().catch(() => null);
        if (busyRef.current || !receiverRef.current) return; // a claim started meanwhile
        if (data && settledState(data)) await finish();
      }, STATUS_POLL_MS));
    } catch (joinError) {
      await stopEverything();
      const status = joinError.response?.status;
      if (status === 403 && joinError.response?.data?.code === "not_enrolled") setState("identity");
      else if (status === 409) await finish();
      else {
        setErrorText(joinError.response?.data?.message || joinError.message || "Could not start listening.");
        setState("error");
      }
    }
  };

  const handleLogout = useCallback(async () => {
    await stopEverything();
    try {
      await axios.get(`${SERVER_URL}/logout`, requestConfig);
    } catch (error) {
      // best-effort
    }
    navigate("/");
  }, [navigate, stopEverything]);

  if (state === "loading" || !user) return <PageLoader label="Loading check-in…" />;

  const session = info?.session;
  const record = info?.record;
  const sessionClass = session?.class;
  const windowLeftMs = session ? new Date(session.closesAt).getTime() - now : 0;
  const graceLeftMs = session?.faceGraceEndsAt ? new Date(session.faceGraceEndsAt).getTime() - now : null;
  const faceDeadlineMs = session?.status === "open" ? windowLeftMs : graceLeftMs;
  const stepIndex = STEP_OF[state] ?? 0;
  const showTracker = !["identity", "device", "error"].includes(state);
  const levelPercent = level === null ? 0 : Math.min(100, Math.max(0, ((level + 90) / 90) * 100));
  const unheardTooLong = state === "listening" && listeningSince && now - listeningSince > HINT_AFTER_MS;

  const doneView = () => {
    const status = record?.status;
    const decided = decisionText(record);
    if (status === "present") {
      return {
        icon: "✓", tone: "success", title: "You’re marked present",
        text: decided || (relayed ? "Done. Your phone also passed the key on to classmates further back." : "Done. You can close this page."),
      };
    }
    if (status === "review" || status === "heard") {
      if (record?.query) return { icon: "💬", tone: "warning", title: "Query sent", text: "Your teacher will look at this check-in again before it locks at 09:00 the next morning." };
      return { icon: "⌛", tone: "warning", title: "In review", text: `Your teacher will check this before 09:00 tomorrow because ${explain(record.reasons) || "the check was not complete"}.` };
    }
    if (status === "absent") {
      return { icon: "✕", tone: "danger", title: "Marked absent", text: decided || (explain(record?.reasons) ? `This check-in has closed: ${explain(record.reasons)}.` : "This check-in has closed and you were not checked in.") };
    }
    return { icon: "⏹", tone: "warning", title: "Check-in closed", text: "This check-in is no longer open." };
  };

  const VIEW = {
    identity: { icon: "🪪", tone: "warning", title: "Finish your identity check first", text: "Check-ins confirm your face against your enrolled photo. It takes about two minutes, once." },
    ready: { icon: "🎧", title: "Ready to check in", text: "Tap Join, allow the microphone and camera, and keep this page open with the screen on." },
    listening: { icon: "👂", title: "Listening for the key…", text: "Keep the phone out of your pocket, face-up. This usually takes a few seconds." },
    submitting: { icon: "🔐", title: "Key heard — confirming…", text: "Your phone is signing the key so the server knows it came from you." },
    "face-intro": { icon: "🙂", title: "Key heard ✓ — now a quick face check", text: "Hold the phone at eye level in good light and follow the oval. It takes a few seconds." },
    face: null,
    "face-checking": { icon: "🔎", title: "Checking your face…", text: "Comparing with your enrolled photo." },
    "face-retry": {
      icon: "↻", tone: "warning", title: "Let’s try that once more",
      text: faceResult?.face?.status === "not_live"
        ? "The camera couldn’t confirm a live face. Use your real face in good light — not a photo or screen."
        : "The match wasn’t certain. Face a light source, remove anything covering your face, and try again.",
    },
    relaying: { icon: "📣", tone: "success", title: "Helping classmates…", text: "Your phone is passing the key on to students further back (about 8 seconds). Keep this page open." },
    done: doneView(),
    device: { icon: "📱", tone: "danger", title: "This phone isn’t approved", text: "Check-ins only count from your approved phone. Sign in again to confirm this phone with your face, or ask your teacher." },
    error: { icon: "⚠", tone: "danger", title: "Something went wrong", text: errorText },
  };
  const view = VIEW[state] || VIEW.error;

  return (
    <AppShell role="student" name={user.name || user.email} email={user.email} onLogout={handleLogout} links={[{ to: "/student-dashboard", label: "Dashboard" }]}>
      <Link to="/student-dashboard" className="ui-btn ui-btn--ghost ui-btn--sm">← Dashboard</Link>

      {showTracker && (
        <ol className="checkin-tracker" aria-label="Check-in progress">
          {STEPS.map((label, index) => (
            <li key={label} className={index < stepIndex || (state === "done" && index === 3) ? "is-done" : index === stepIndex ? "is-current" : ""}>
              <span className="checkin-tracker__dot">{index < stepIndex || (state === "done" && index === 3) ? "✓" : index + 1}</span>
              <span className="checkin-tracker__label">{label}</span>
            </li>
          ))}
        </ol>
      )}

      <Card className="checkin-card">
        {sessionClass && <p className="ui-muted checkin-class">{sessionClass.courseCode}{sessionClass.section ? ` · ${sessionClass.section}` : ""} — {sessionClass.title}</p>}

        {state === "face" ? (
          <Suspense fallback={<div className="checkin-hero"><Spinner /> <span className="ui-muted">Opening the camera check…</span></div>}>
            <FaceCheck purpose="checkin" extra={{ sessionId }} onFinished={submitFace} onCancel={() => setState(faceResult ? "face-retry" : "face-intro")} />
          </Suspense>
        ) : (
          <div className="checkin-hero">
            <span className={`checkin-hero__icon ${view.tone ? `checkin-hero__icon--${view.tone}` : ""} ${["listening", "relaying"].includes(state) ? "checkin-pulse" : ""}`}>{view.icon}</span>
            <h1 className="checkin-hero__title">{view.title}</h1>
            <p className="checkin-hero__text">{view.text}</p>

            {state === "listening" && (
              <>
                <div className="checkin-level" aria-label="Microphone level"><span style={{ width: `${levelPercent}%` }} /></div>
                {windowLeftMs > 0 && <p className="ui-muted">Check-in closes in {formatClock(windowLeftMs)}</p>}
              </>
            )}
            {unheardTooLong && (
              <p className="checkin-hero__text">Not heard yet. Move a little closer to the front or to a classmate whose phone is out, and keep this page open — it keeps trying until the check-in closes.</p>
            )}
            {["face-intro", "face-retry"].includes(state) && faceDeadlineMs !== null && faceDeadlineMs > 0 && (
              <p className={`checkin-deadline ${session?.status !== "open" ? "checkin-deadline--grace" : ""}`}>
                {session?.status === "open" ? `Finish within ${formatClock(faceDeadlineMs)}` : `Check-in closed — finish your face check within ${formatClock(faceDeadlineMs)}`}
              </p>
            )}
            {state === "face-retry" && <p className="ui-muted">Attempt {faceResult?.face?.attempts} of {faceResult?.face?.maxAttempts} used.</p>}
            {["submitting", "face-checking"].includes(state) && <Spinner />}
            {state === "done" && record?.query && (
              <blockquote className="query-quote query-quote--own">
                <strong>{queryReasonLabel(record.query.reason)}</strong>
                {record.query.text && <span>“{record.query.text}”</span>}
                <cite>Your query</cite>
              </blockquote>
            )}

            <div className="checkin-hero__actions">
              {state === "done" && record?.canQuery && (
                <Button size="lg" onClick={() => setQuerying(true)}>Raise a query</Button>
              )}
              {state === "identity" && <Button size="lg" onClick={() => navigate("/student/enroll")}>Complete identity check</Button>}
              {state === "ready" && <Button size="lg" onClick={join}>Join check-in</Button>}
              {state === "face-intro" && <Button size="lg" onClick={() => { setErrorText(""); setState("face"); }}>Start face check</Button>}
              {state === "face-retry" && (
                <>
                  <Button size="lg" onClick={() => setState("face")}>Try again</Button>
                  <Button variant="ghost" onClick={skipFace}>Skip — let my teacher review</Button>
                </>
              )}
              {state === "error" && <Button onClick={() => window.location.reload()}>Reload</Button>}
              {["done", "device", "identity"].includes(state) && (
                <Button variant="secondary" onClick={() => navigate("/student-dashboard")}>Back to dashboard</Button>
              )}
            </div>
            {state === "done" && record?.canQuery && session?.lockAt && (
              <p className="ui-muted">Something went wrong? You can raise one query {untilLabel(session.lockAt, now)}.</p>
            )}
            {errorText && state === "face-intro" && <p className="ui-field__error">{errorText}</p>}
          </div>
        )}
      </Card>

      {querying && record && (
        <Suspense fallback={null}>
          <QuerySheet
            recordId={record._id}
            classLabel={sessionClass ? `${sessionClass.courseCode}${sessionClass.section ? ` · ${sessionClass.section}` : ""}` : ""}
            lockAt={session?.lockAt}
            onDone={() => {
              setQuerying(false);
              toast("Query sent. Your teacher will see it on their review list.", "success");
              loadStatus().catch(() => {});
            }}
            onClose={() => setQuerying(false)}
          />
        </Suspense>
      )}
    </AppShell>
  );
};

export default CheckIn;
