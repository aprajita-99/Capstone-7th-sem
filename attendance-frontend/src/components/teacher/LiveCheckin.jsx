import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { PageLoader } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { teacherLinks, useTeacherSession } from "./teacherSession";
import CheckinStudents from "./CheckinStudents";
import { downloadFile } from "../../utils/download";
import { lockLabel } from "../../utils/lockTime";
import "./classes.css";
import "./reviews.css";
import "../checkin.css";

const SpotCheckSheet = lazy(() => import("./SpotCheckSheet"));

const { FrameReceiver } = receiverModule;
const requestConfig = { withCredentials: true };
const errorMessage = (requestError, fallback) => requestError.response?.data?.message || fallback;
const SPEAKER_CHECK_MS = 8000;
const STRONG_MARGIN_DB = 20;
const BEACON_POLL_MS = 3000;
const LIVE_POLL_MS = 2000;
const GRACE_POLL_MS = 3000;

const formatClock = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Teacher's phone: speaker check → Start → plays the session key on loop at
 * full volume for the whole window (FEATURES.md §3.6) while students check in
 * with sound + face. Also the read-only summary of a past check-in
 * (/teacher/sessions/:sessionId), where review cases can still be decided the same day.
 */
const LiveCheckin = () => {
  const params = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, logout, counts: reviewCounts, refreshCounts } = useTeacherSession();
  const summaryMode = Boolean(params.sessionId);
  const [searchParams] = useSearchParams();
  const initialStudent = searchParams.get("student");
  const [exporting, setExporting] = useState(false);
  const [headcountInput, setHeadcountInput] = useState("");
  const [headcountSaving, setHeadcountSaving] = useState(false);
  const [spotOpen, setSpotOpen] = useState(false);

  const [classId, setClassId] = useState(params.classId || null);
  const [courseClass, setCourseClass] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [faceService, setFaceService] = useState(true);
  const [session, setSession] = useState(null);
  const [live, setLive] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading | precheck | live | closed
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

  const loadLive = useCallback(async (sessionId) => {
    const response = await axios.get(`${SERVER_URL}/sessions/${sessionId}`, requestConfig);
    setLive(response.data);
    setSession(response.data.session);
    if (response.data.class) setCourseClass((existing) => existing || response.data.class);
    if (response.data.session.status !== "open") {
      await stopAudio();
      setPhase("closed");
    }
    return response.data;
  }, [stopAudio]);

  // Initial load: live page (class → open session or precheck) or a past check-in summary.
  useEffect(() => {
    if (!user) return;
    if (summaryMode) {
      loadLive(params.sessionId)
        .then((data) => {
          setClassId(String(data.session.class));
          if (data.session.status === "open") navigate(`/teacher/classes/${data.session.class}/live`, { replace: true });
        })
        .catch((requestError) => {
          toast(errorMessage(requestError, "Could not load this check-in."), "error");
          navigate("/teacher/classes");
        });
      return;
    }
    Promise.all([
      axios.get(`${SERVER_URL}/classes/${params.classId}`, requestConfig),
      axios.get(`${SERVER_URL}/classes/${params.classId}/sessions`, requestConfig),
    ])
      .then(([classResponse, sessionsResponse]) => {
        setCourseClass(classResponse.data.courseClass);
        setDefaults(sessionsResponse.data.defaults);
        setFaceService(sessionsResponse.data.faceService !== false);
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
  }, [user, summaryMode, params.classId, params.sessionId, loadLive, navigate, toast]);

  // Polling: every 2 s while live, every 3 s during the 2-minute face grace after closing.
  const graceEndsAt = session?.faceGraceEndsAt ? new Date(session.faceGraceEndsAt).getTime() : null;
  const inGrace = phase === "closed" && graceEndsAt !== null && now < graceEndsAt;
  useEffect(() => {
    if (!session?._id || phase === "precheck" || phase === "loading") return undefined;
    loadLive(session._id).catch(() => {});
    if (phase !== "live" && !inGrace) return undefined;
    const timer = window.setInterval(() => loadLive(session._id).catch(() => {}), phase === "live" ? LIVE_POLL_MS : GRACE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [session?._id, phase, inGrace, loadLive]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    if (!window.confirm("Close this check-in? Students who joined but were not heard go to review; students still finishing their face check get 2 more minutes; the rest of the roster is marked absent.")) return;
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

  // Review decision or present ↔ absent override; resolves true when saved.
  const decide = async (record, status, note) => {
    setBusy(true);
    try {
      const response = await axios.post(`${SERVER_URL}/records/${record._id}/decision`, { status, note }, requestConfig);
      const changed = response.data.record?.decision?.kind === "override" ? "changed to" : "marked";
      toast(`${record.name || record.email.split("@")[0]} ${changed} ${status}.`, "success");
      await loadLive(session._id);
      refreshCounts();
      return true;
    } catch (requestError) {
      toast(errorMessage(requestError, "Could not save the decision."), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile(`${SERVER_URL}/sessions/${session._id}/export.csv`, "checkin.csv");
    } catch (requestError) {
      toast("Could not download the CSV.", "error");
    } finally {
      setExporting(false);
    }
  };

  const saveHeadcount = async (event) => {
    event.preventDefault();
    setHeadcountSaving(true);
    try {
      const response = await axios.patch(`${SERVER_URL}/sessions/${session._id}/headcount`, { headcount: Number(headcountInput) }, requestConfig);
      setSession(response.data.session);
      setHeadcountInput("");
      toast(response.data.warning ? `Saved — ${response.data.warning}.` : "Head count saved.", response.data.warning ? "error" : "success");
      await loadLive(session._id);
    } catch (requestError) {
      toast(errorMessage(requestError, "Could not save the head count."), "error");
    } finally {
      setHeadcountSaving(false);
    }
  };

  if (!user || phase === "loading") return <PageLoader label="Loading check-in…" />;

  const counts = live?.counts || { joined: 0, heard: 0, present: 0, review: 0, absent: 0 };
  const remainingMs = session ? new Date(session.closesAt).getTime() - now : 0;
  const locked = Boolean(session?.locked) || (session?.lockAt ? now > new Date(session.lockAt).getTime() : false);
  const headcount = live?.session?.headcount ?? session?.headcount ?? null;
  const overCount = headcount !== null && counts.present > headcount;
  const title = courseClass ? `${courseClass.courseCode}${courseClass.section ? ` · ${courseClass.section}` : ""}` : "Check-in";
  const startedLabel = session?.startedAt
    ? new Date(session.startedAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <AppShell role="teacher" name={user.name || user.email} email={user.email} onLogout={logout} links={teacherLinks("classes", reviewCounts)}>
      {classId && (
        <Link to={`/teacher/classes/${classId}${initialStudent ? "?tab=attendance" : ""}`} className="class-back">
          {initialStudent ? "← Back to attendance" : "← Back to class"}
        </Link>
      )}
      <div className="ui-page-head">
        <div>
          <h1 className="ui-page-head__title">{phase === "closed" ? "Check-in summary" : "Live check-in"} — {title}</h1>
          <p className="ui-page-head__sub">{courseClass?.title}{startedLabel ? ` · ${startedLabel}` : ""}</p>
        </div>
        {phase === "closed" && session && (
          <div className="ui-page-head__actions">
            <Button variant="secondary" loading={exporting} onClick={exportCsv}>⬇ Export CSV</Button>
          </div>
        )}
      </div>

      {phase === "precheck" && (
        <Card>
          <div className="checkin-hero">
            <span className="checkin-hero__icon">🔊</span>
            <h2 className="checkin-hero__title">Before you start</h2>
            <ol className="checkin-steps">
              <li><span className="checkin-steps__num">1</span><span><strong>Turn this phone’s media volume to maximum.</strong> The key is near-silent; volume decides how far it reaches.</span></li>
              <li><span className="checkin-steps__num">2</span><span>Keep this page open with the screen on, phone face-up — as far from the door as you can.</span></li>
              <li><span className="checkin-steps__num">3</span><span>Run the 8-second speaker check so you know this phone is loud enough.</span></li>
            </ol>

            {!faceService && <Badge variant="danger" dot>Face checks are not available on the server — students will land in review</Badge>}
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
            <p className="ui-muted">Window: {defaults?.windowMin || 6} minutes · band {fsk.profileRange(fsk.PROFILES[defaults?.profile] || fsk.PROFILES.mid)} · sound + face check</p>
          </div>
        </Card>
      )}

      {(phase === "live" || phase === "closed") && session && (
        <>
          <Card className="checkin-status">
            <div className="checkin-status__main">
              {phase === "live" ? (
                <>
                  <span className={`checkin-hero__icon ${playing ? "checkin-pulse" : ""}`}>🔊</span>
                  <div>
                    <div className="checkin-timer">{formatClock(remainingMs)}</div>
                    <p className="ui-muted">
                      {playing ? "Playing the key — keep this phone face-up with the screen on." : "Open, but this phone is not playing the key."}
                    </p>
                  </div>
                  <div className="checkin-status__actions">
                    {!playing && <Button onClick={resumePlaying} loading={busy}>Play key on this phone</Button>}
                    <Button variant="danger" onClick={closeCheckin} disabled={busy}>Close check-in</Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="checkin-hero__icon checkin-hero__icon--success">✓</span>
                  <div>
                    <h2 className="checkin-hero__title">Check-in closed</h2>
                    <p className="ui-muted">
                      {inGrace
                        ? `Students who heard the key can finish their face check for ${formatClock(graceEndsAt - now)} more.`
                        : locked
                          ? "Locked — nothing can change now. Undecided review cases were marked absent and check-in photos were deleted."
                          : `Decide the review cases below. ${lockLabel(session.lockAt, now)} — undecided cases are then marked absent.`}
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="checkin-stats">
              <div className="checkin-stat checkin-stat--present"><strong>{counts.present}</strong><span>Present</span></div>
              <div className="checkin-stat checkin-stat--review"><strong>{counts.review}</strong><span>Review</span></div>
              <div className="checkin-stat"><strong>{(counts.joined || 0) + (counts.heard || 0)}</strong><span>Listening</span></div>
              <div className="checkin-stat"><strong>{counts.absent}</strong><span>Absent</span></div>
              <div className="checkin-stat"><strong>{live?.rosterSize ?? "—"}</strong><span>On roster</span></div>
            </div>
            {!locked && (
              <div className="checkin-tools">
                <form className="headcount" onSubmit={saveHeadcount}>
                  <label htmlFor="headcount-input" className="headcount__label">
                    Head count
                    {headcount !== null && <span className="ui-muted"> · counted {headcount}</span>}
                  </label>
                  <div className="headcount__row">
                    <input
                      id="headcount-input"
                      className="ui-input headcount__input"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="500"
                      placeholder={headcount !== null ? String(headcount) : "Heads in the room"}
                      value={headcountInput}
                      onChange={(event) => setHeadcountInput(event.target.value)}
                    />
                    <Button type="submit" variant="secondary" loading={headcountSaving} disabled={headcountInput === ""}>Save</Button>
                  </div>
                </form>
                <Button variant="soft" className="checkin-tools__spot" onClick={() => setSpotOpen(true)} disabled={counts.present === 0}>
                  🎯 Spot-check 5
                </Button>
              </div>
            )}
            {overCount && (
              <Badge variant="danger" dot>
                {counts.present} marked present but you counted {headcount} — run a spot-check
              </Badge>
            )}
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
          </Card>

          <Card className="classes-section" title="Students" subtitle={phase === "live" ? "Updates every 2 seconds. Tap a student for their frames and timeline." : "Tap a student for their frames and timeline."}>
            <CheckinStudents records={live?.records || []} locked={locked} busy={busy} onDecide={decide} initialStudent={initialStudent} />
          </Card>
        </>
      )}

      {spotOpen && session && (
        <Suspense fallback={null}>
          <SpotCheckSheet sessionId={session._id} locked={locked} onDecide={decide} onClose={() => setSpotOpen(false)} />
        </Suspense>
      )}
    </AppShell>
  );
};

export default LiveCheckin;
