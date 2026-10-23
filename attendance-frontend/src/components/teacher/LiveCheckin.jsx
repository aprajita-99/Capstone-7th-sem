import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import fsk from "../../acoustic/fsk";
import receiverModule from "../../acoustic/receiver";
import { createAudioContext, openMic } from "../../acoustic/mic";
import { createTransmitter } from "../../acoustic/transmitter";
import { keepScreenOn } from "../../acoustic/wakeLock";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import { PageLoader } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { teacherLinks, useTeacherSession } from "./teacherSession";
import "./classes.css";
import "../checkin.css";

const { FrameReceiver } = receiverModule;
const requestConfig = { withCredentials: true };
const errorMessage = (requestError, fallback) => requestError.response?.data?.message || fallback;
const SPEAKER_CHECK_MS = 8000;
const STRONG_MARGIN_DB = 20;
const BEACON_POLL_MS = 3000;
const LIVE_POLL_MS = 2000;

const formatClock = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const STATUS_BADGE = {
  present: { variant: "success", label: "Present" },
  joined: { variant: "info", label: "Listening" },
  review: { variant: "warning", label: "Review" },
  absent: { variant: "neutral", label: "Absent" },
};

/**
 * Teacher's phone: speaker check → Start → plays the session key on loop at
 * full volume for the whole window (FEATURES.md §3.6) while names come in.
 */
const LiveCheckin = () => {
  const { classId } = useParams();
  const toast = useToast();
  const { user, logout } = useTeacherSession();

  const [courseClass, setCourseClass] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [session, setSession] = useState(null);
  const [live, setLive] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading | precheck | ready | live | closed
  const [speaker, setSpeaker] = useState(null); // { status: "running" | "strong" | "weak" | "silent", marginDb }
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const audioRef = useRef(null);
  const timersRef = useRef([]);
  const keyRef = useRef(null);

  const stopAudio = useCallback(async () => {
    timersRef.current.forEach((timer) => window.clearInterval(timer));
    timersRef.current = [];
    const audio = audioRef.current;
    audioRef.current = null;
    audio?.transmitter?.stop();
    await audio?.wakeLock?.release();
    if (audio?.context) await audio.context.close().catch(() => {});
    keyRef.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => () => {
    stopAudio();
  }, [stopAudio]);

  // Initial load: class + open session (resume) or a fresh start.
  useEffect(() => {
    if (!user) return;
    Promise.all([
      axios.get(`${SERVER_URL}/classes/${classId}`, requestConfig),
      axios.get(`${SERVER_URL}/classes/${classId}/sessions`, requestConfig),
    ])
      .then(([classResponse, sessionsResponse]) => {
        setCourseClass(classResponse.data.courseClass);
        setDefaults(sessionsResponse.data.defaults);
        if (sessionsResponse.data.openSession) {
          setSession(sessionsResponse.data.openSession);
          setPhase("live");
        } else {
          setPhase("precheck");
        }
      })
      .catch((requestError) => {
        toast(errorMessage(requestError, "Could not load this class."), "error");
        setPhase("precheck");
      });
  }, [user, classId, toast]);

  const loadLive = useCallback(async (sessionId) => {
    const response = await axios.get(`${SERVER_URL}/sessions/${sessionId}`, requestConfig);
    setLive(response.data);
    setSession(response.data.session);
    if (response.data.session.status !== "open") {
      await stopAudio();
      setPhase("closed");
    }
    return response.data;
  }, [stopAudio]);

  // Live polling of counts / names whenever a session is shown.
  useEffect(() => {
    if (!session?._id || phase === "precheck" || phase === "loading") return undefined;
    loadLive(session._id).catch(() => {});
    if (phase !== "live") return undefined;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      loadLive(session._id).catch(() => {});
    }, LIVE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [session?._id, phase, loadLive]);

  const runSpeakerCheck = async () => {
    setSpeaker({ status: "running" });
    let mic;
    let transmitter;
    try {
      const profile = fsk.PROFILES[defaults?.profile] || fsk.PROFILES.mid;
      const receiver = { current: null };
      mic = await openMic({ onChunk: (chunk) => receiver.current?.push(chunk) });
      receiver.current = new FrameReceiver({ sampleRate: mic.sampleRate, profile, combineRepeats: false });
      transmitter = createTransmitter(mic.context);
      const testKey = Math.floor(Math.random() * fsk.MAX_FRAME_VALUE);
      transmitter.setFrame({ value: testKey, profile });
      transmitter.start({ volume: 1, gapMs: 300 });

      const margins = [];
      const deadline = Date.now() + SPEAKER_CHECK_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        receiver.current.scan().filter((frame) => frame.value === testKey).forEach((frame) => margins.push(frame.minMarginDb));
      }
      const best = margins.length ? Math.max(...margins) : null;
      setSpeaker({ status: best === null ? "silent" : best >= STRONG_MARGIN_DB ? "strong" : "weak", marginDb: best });
    } catch (checkError) {
      setSpeaker({ status: "error", message: checkError.message });
    } finally {
      transmitter?.stop();
      await mic?.stop();
    }
  };

  // Plays the current beacon key on loop; picks up rotated keys every few seconds.
  const startPlaying = async (sessionId, profileId) => {
    const profile = fsk.PROFILES[profileId] || fsk.PROFILES.mid;
    const context = await createAudioContext();
    const transmitter = createTransmitter(context);
    const wakeLock = await keepScreenOn();
    audioRef.current = { context, transmitter, wakeLock };

    const refreshKey = async () => {
      const response = await axios.get(`${SERVER_URL}/sessions/${sessionId}/beacon`, requestConfig);
      if (response.data.value !== keyRef.current) {
        keyRef.current = response.data.value;
        transmitter.setFrame({ value: response.data.value, profile });
      }
    };
    await refreshKey();
    transmitter.start({ volume: 1, gapMs: 300 });
    setPlaying(true);
    timersRef.current.push(window.setInterval(() => {
      refreshKey().catch(async (requestError) => {
        if (requestError.response?.status === 409) {
          await stopAudio();
          setPhase("closed");
        }
      });
    }, BEACON_POLL_MS));
  };

  const startCheckin = async () => {
    setBusy(true);
    try {
      const response = await axios.post(`${SERVER_URL}/classes/${classId}/sessions`, {}, requestConfig);
      setSession(response.data.session);
      setPhase("live");
      await startPlaying(response.data.session._id, response.data.session.settings.profile);
    } catch (requestError) {
      toast(errorMessage(requestError, requestError.message || "Could not start the check-in."), "error");
    } finally {
      setBusy(false);
    }
  };

  const resumePlaying = async () => {
    setBusy(true);
    try {
      await startPlaying(session._id, session.settings.profile);
    } catch (requestError) {
      toast(errorMessage(requestError, requestError.message || "Could not start the sound."), "error");
    } finally {
      setBusy(false);
    }
  };

  const closeCheckin = async () => {
    if (!window.confirm("Close this check-in? Students who joined but were not heard go to review; the rest of the roster is marked absent.")) return;
    setBusy(true);
    try {
      await stopAudio();
      await axios.post(`${SERVER_URL}/sessions/${session._id}/close`, {}, requestConfig);
      await loadLive(session._id);
      setPhase("closed");
      toast("Check-in closed.", "success");
    } catch (requestError) {
      toast(errorMessage(requestError, "Could not close the check-in."), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!user || phase === "loading") return <PageLoader label="Loading check-in…" />;

  const counts = live?.counts || { joined: 0, present: 0, review: 0, absent: 0 };
  const remainingMs = session ? new Date(session.closesAt).getTime() - now : 0;
  const title = courseClass ? `${courseClass.courseCode}${courseClass.section ? ` · ${courseClass.section}` : ""}` : "Check-in";

  return (
    <AppShell role="teacher" name={user.name || user.email} email={user.email} onLogout={logout} links={teacherLinks("classes")}>
      <Link to={`/teacher/classes/${classId}`} className="class-back">← Back to class</Link>
      <div className="ui-page-head">
        <div>
          <h1 className="ui-page-head__title">Live check-in — {title}</h1>
          <p className="ui-page-head__sub">{courseClass?.title}</p>
        </div>
      </div>

      {phase === "precheck" && (
        <Card>
          <div className="checkin-hero">
            <span className="checkin-hero__icon">🔊</span>
            <h2 className="checkin-hero__title">Before you start</h2>
            <ol className="checkin-steps">
              <li><span className="checkin-steps__num">1</span><span><strong>Turn this phone’s media volume to maximum.</strong> The key is near-silent; volume decides how far it reaches.</span></li>
              <li><span className="checkin-steps__num">2</span><span>Keep this page open with the screen on, phone face-up at the front of the room.</span></li>
              <li><span className="checkin-steps__num">3</span><span>Run the 8-second speaker check so you know this phone is loud enough.</span></li>
            </ol>

            {speaker?.status === "running" && <Badge variant="info" dot>Checking speaker… keep the phone still</Badge>}
            {speaker?.status === "strong" && <Badge variant="success" dot>Speaker strong ({speaker.marginDb.toFixed(0)} dB) — ready</Badge>}
            {speaker?.status === "weak" && <Badge variant="warning" dot>Speaker weak ({speaker.marginDb.toFixed(0)} dB) — raise volume, or use a phone with a louder speaker</Badge>}
            {speaker?.status === "silent" && <Badge variant="danger" dot>Not heard — check the volume isn’t muted, then retry</Badge>}
            {speaker?.status === "error" && <Badge variant="danger" dot>{speaker.message}</Badge>}

            <div className="checkin-hero__actions">
              <Button variant="secondary" onClick={runSpeakerCheck} loading={speaker?.status === "running"}>
                {speaker && speaker.status !== "running" ? "Check again" : "Check speaker"}
              </Button>
              <Button onClick={startCheckin} loading={busy} disabled={speaker?.status === "running"}>
                {speaker?.status === "strong" ? "Start check-in" : "Start anyway"}
              </Button>
            </div>
            <p className="ui-muted">Window: {defaults?.windowMin || 6} minutes · band {fsk.profileRange(fsk.PROFILES[defaults?.profile] || fsk.PROFILES.mid)}</p>
          </div>
        </Card>
      )}

      {(phase === "live" || phase === "closed") && session && (
        <div className="checkin-grid">
          <Card>
            <div className="checkin-hero">
              {phase === "live" ? (
                <>
                  <span className={`checkin-hero__icon ${playing ? "checkin-pulse" : ""}`}>🔊</span>
                  <div className="checkin-timer">{formatClock(remainingMs)}</div>
                  <p className="checkin-hero__text">
                    {playing
                      ? "Playing the key. Keep this phone face-up with the screen on until the timer ends."
                      : "This check-in is open but this phone is not playing. Tap below to play the key."}
                  </p>
                  <div className="checkin-hero__actions">
                    {!playing && <Button onClick={resumePlaying} loading={busy}>Play key on this phone</Button>}
                    <Button variant="danger" onClick={closeCheckin} disabled={busy}>Close check-in</Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="checkin-hero__icon checkin-hero__icon--success">✓</span>
                  <h2 className="checkin-hero__title">Check-in closed</h2>
                  <p className="checkin-hero__text">Students who joined but were not heard are in review. Everyone else on the roster without a check-in is absent.</p>
                </>
              )}
            </div>
            <div className="ui-grid ui-grid--stats">
              <div className="ui-stat"><div><div className="ui-stat__value">{counts.present}</div><div className="ui-stat__label">Present</div></div></div>
              <div className="ui-stat"><div><div className="ui-stat__value">{counts.joined}</div><div className="ui-stat__label">Listening</div></div></div>
              <div className="ui-stat"><div><div className="ui-stat__value">{counts.review}</div><div className="ui-stat__label">Review</div></div></div>
              <div className="ui-stat"><div><div className="ui-stat__value">{live?.rosterSize ?? "—"}</div><div className="ui-stat__label">On roster</div></div></div>
            </div>
          </Card>

          <Card title="Students" subtitle="Updates every 2 seconds. Wave 1 heard this phone; later waves heard a classmate's relay.">
            {live?.byWave && Object.keys(live.byWave).length > 0 && (
              <div className="wave-bars" aria-label="Present students by wave">
                {Object.entries(live.byWave).map(([wave, count]) => {
                  const most = Math.max(...Object.values(live.byWave));
                  return (
                    <div key={wave} className="wave-bar">
                      <span className="wave-bar__label">Wave {wave}</span>
                      <span className="wave-bar__track"><span style={{ width: `${(count / most) * 100}%` }} /></span>
                      <strong>{count}</strong>
                    </div>
                  );
                })}
              </div>
            )}
            {!live || live.records.length === 0 ? (
              <EmptyState icon="👂" title="Nobody yet" text="Names appear here as students join and their phones hear the key." />
            ) : (
              <ul className="checkin-names">
                {live.records.map((record) => {
                  const badge = STATUS_BADGE[record.status] || STATUS_BADGE.absent;
                  return (
                    <li key={record.email} className="checkin-name">
                      <span className="checkin-name__who">
                        <strong>{record.name || record.email.split("@")[0]}</strong>
                        <span>{record.email}{record.wave ? ` · wave ${record.wave}` : ""}{record.reasons?.includes("not_heard") ? " · not heard" : ""}</span>
                      </span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
};

export default LiveCheckin;
