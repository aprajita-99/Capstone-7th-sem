import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import fsk from "../../acoustic/fsk";
import receiverModule from "../../acoustic/receiver";
import { levelDb, openMic } from "../../acoustic/mic";
import { keepScreenOn } from "../../acoustic/wakeLock";
import { signDeviceChallenge } from "../../utils/deviceKey";
import AppShell from "../../ui/AppShell";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import { PageLoader } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import "../checkin.css";

const { FrameReceiver } = receiverModule;
const requestConfig = { withCredentials: true };
const SCAN_MS = 500;
const STATUS_POLL_MS = 5000;
const HINT_AFTER_MS = 60 * 1000;

const VIEW = {
  ready: { icon: "🎧", title: "Ready to check in", text: "Tap Join, allow the microphone, and keep this page open near the front of the room." },
  listening: { icon: "👂", title: "Listening for the key…", text: "Keep the phone out of your pocket with the screen on. This usually takes a few seconds." },
  submitting: { icon: "🔐", title: "Key heard — confirming…", text: "Your phone is signing the key so the server knows it came from you." },
  present: { icon: "✓", tone: "success", title: "You’re marked present", text: "Done. You can close this page." },
  review: { icon: "⌛", tone: "warning", title: "In review", text: "Your phone joined but did not hear the key. Your teacher will review it today." },
  absent: { icon: "✕", tone: "danger", title: "Marked absent", text: "This check-in has closed and you were not checked in." },
  closed: { icon: "⏹", tone: "warning", title: "Check-in closed", text: "This check-in is no longer open." },
  device: { icon: "📱", tone: "danger", title: "This phone isn’t approved", text: "Check-ins only count from your approved phone. If you changed phones, ask your teacher to approve this one." },
  error: { icon: "⚠", tone: "danger", title: "Something went wrong", text: "" },
};

// Terminal screen for a /me response, or null while still open and not present.
const finalState = (data) => {
  const status = data.record?.status;
  if (status === "present") return "present";
  if (data.session.status !== "open") return status === "review" ? "review" : status === "absent" ? "absent" : "closed";
  return null;
};

const CheckIn = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [user, setUser] = useState(null);
  const [info, setInfo] = useState(null); // { session, record }
  const [state, setState] = useState("loading");
  const [errorText, setErrorText] = useState("");
  const [level, setLevel] = useState(null);
  const [listeningSince, setListeningSince] = useState(null);
  const [now, setNow] = useState(Date.now());

  const audioRef = useRef(null);
  const receiverRef = useRef(null);
  const levelRef = useRef(null);
  const timersRef = useRef([]);
  const triedKeysRef = useRef(new Set());
  const claimingRef = useRef(false);

  const stopListening = useCallback(async () => {
    timersRef.current.forEach((timer) => window.clearInterval(timer));
    timersRef.current = [];
    receiverRef.current = null;
    const audio = audioRef.current;
    audioRef.current = null;
    await audio?.wakeLock?.release();
    await audio?.mic?.stop();
  }, []);

  useEffect(() => () => {
    stopListening();
  }, [stopListening]);

  const loadStatus = useCallback(async () => {
    const response = await axios.get(`${SERVER_URL}/sessions/${sessionId}/me`, requestConfig);
    setInfo(response.data);
    return response.data;
  }, [sessionId]);

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
        setState(finalState(data) || "ready");
      })
      .catch((requestError) => {
        if (requestError.response?.status === 401) navigate("/login");
        else {
          setErrorText(requestError.response?.data?.message || "Could not load this check-in.");
          setState("error");
        }
      });
  }, [navigate, loadStatus]);

  const claim = async (key) => {
    claimingRef.current = true;
    setState("submitting");
    try {
      const proof = await signDeviceChallenge({ purpose: "claim", payload: { sessionId, key } });
      const response = await axios.post(`${SERVER_URL}/sessions/${sessionId}/claims`, { key, ...proof }, requestConfig);
      if (response.data.status === "present") {
        await stopListening();
        setState("present");
        toast("You’re marked present.", "success");
        return;
      }
      setState("listening");
    } catch (requestError) {
      const status = requestError.response?.status;
      if (status === 400) {
        setState("listening"); // not this session's key (e.g. a nearby class); keep listening
      } else if (status === 401) {
        await stopListening();
        setState("device");
      } else if (status === 409) {
        await stopListening();
        const data = await loadStatus().catch(() => null);
        setState((data && finalState(data)) || "closed");
      } else {
        triedKeysRef.current.delete(key); // network hiccup: allow this key to be retried
        setState("listening");
      }
    } finally {
      claimingRef.current = false;
    }
  };

  const join = async () => {
    setErrorText("");
    try {
      const joinResponse = await axios.post(`${SERVER_URL}/sessions/${sessionId}/join`, {}, requestConfig);
      const profile = fsk.PROFILES[joinResponse.data.session.profile] || fsk.PROFILES.mid;
      const mic = await openMic({
        onChunk: (chunk) => {
          receiverRef.current?.push(chunk);
          levelRef.current = levelDb(chunk);
        },
      });
      const wakeLock = await keepScreenOn();
      audioRef.current = { mic, wakeLock };
      receiverRef.current = new FrameReceiver({ sampleRate: mic.sampleRate, profile });
      setListeningSince(Date.now());
      setState("listening");

      timersRef.current.push(window.setInterval(() => {
        setNow(Date.now());
        setLevel(levelRef.current);
        const frames = receiverRef.current?.scan() || [];
        const fresh = frames.find((frame) => !triedKeysRef.current.has(frame.value));
        if (fresh && !claimingRef.current) {
          triedKeysRef.current.add(fresh.value);
          claim(fresh.value);
        }
      }, SCAN_MS));

      timersRef.current.push(window.setInterval(async () => {
        const data = await loadStatus().catch(() => null);
        const done = data && finalState(data);
        if (done) {
          await stopListening();
          setState(done);
        }
      }, STATUS_POLL_MS));
    } catch (joinError) {
      await stopListening();
      const message = joinError.response?.data?.message || joinError.message || "Could not start listening.";
      if (joinError.response?.status === 409) {
        setState("closed");
      } else {
        setErrorText(message);
        setState("error");
      }
    }
  };

  const handleLogout = useCallback(async () => {
    await stopListening();
    try {
      await axios.get(`${SERVER_URL}/logout`, requestConfig);
    } catch (error) {
      // best-effort
    }
    navigate("/");
  }, [navigate, stopListening]);

  if (state === "loading" || !user) return <PageLoader label="Loading check-in…" />;

  const view = VIEW[state] || VIEW.error;
  const sessionClass = info?.session?.class;
  const closesInMs = info?.session ? new Date(info.session.closesAt).getTime() - now : 0;
  const unheardTooLong = state === "listening" && listeningSince && now - listeningSince > HINT_AFTER_MS;
  const levelPercent = level === null ? 0 : Math.min(100, Math.max(0, ((level + 90) / 90) * 100));

  return (
    <AppShell
      role="student"
      name={user.name || user.email}
      email={user.email}
      onLogout={handleLogout}
      links={[{ to: "/student-dashboard", label: "Dashboard" }]}
    >
      <Link to="/student-dashboard" className="ui-btn ui-btn--ghost ui-btn--sm">← Dashboard</Link>
      <Card className="checkin-card">
        <div className="checkin-hero">
          <span className={`checkin-hero__icon ${view.tone ? `checkin-hero__icon--${view.tone}` : ""} ${state === "listening" ? "checkin-pulse" : ""}`}>{view.icon}</span>
          {sessionClass && <p className="ui-muted">{sessionClass.courseCode}{sessionClass.section ? ` · ${sessionClass.section}` : ""} — {sessionClass.title}</p>}
          <h1 className="checkin-hero__title">{view.title}</h1>
          <p className="checkin-hero__text">{state === "error" ? errorText : view.text}</p>

          {state === "listening" && (
            <>
              <div className="checkin-level" aria-label="Microphone level"><span style={{ width: `${levelPercent}%` }} /></div>
              {closesInMs > 0 && <p className="ui-muted">Check-in closes in {Math.floor(closesInMs / 60000)}:{String(Math.floor((closesInMs % 60000) / 1000)).padStart(2, "0")}</p>}
            </>
          )}
          {unheardTooLong && (
            <p className="checkin-hero__text">
              Not heard yet. Move a little closer to the front or to a classmate whose phone is out, and keep this page open — it keeps trying until the check-in closes.
            </p>
          )}

          <div className="checkin-hero__actions">
            {state === "ready" && <Button size="lg" onClick={join}>Join check-in</Button>}
            {state === "error" && <Button onClick={join}>Try again</Button>}
            {["present", "review", "absent", "closed", "device"].includes(state) && (
              <Button variant="secondary" onClick={() => navigate("/student-dashboard")}>Back to dashboard</Button>
            )}
          </div>
        </div>
      </Card>
    </AppShell>
  );
};

export default CheckIn;
