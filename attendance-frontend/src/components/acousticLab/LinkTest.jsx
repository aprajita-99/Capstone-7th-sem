import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import fsk from "../../acoustic/fsk";
import receiverModule from "../../acoustic/receiver";
import { createAudioContext, levelDb, openMic } from "../../acoustic/mic";
import { createTransmitter } from "../../acoustic/transmitter";
import { keepScreenOn } from "../../acoustic/wakeLock";
import Brand from "../../ui/Brand";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import "./acousticLab.css";

const { FrameReceiver } = receiverModule;
const DEFAULT_KEY = "1234567";
const GAP_MS = 300;
const SCAN_MS = 500;
// The codec's detection rule is 9 dB above the median tone (plan.md). A second
// receiver at 5 dB runs alongside purely as a measurement, to learn whether a
// lower threshold would rescue weak rooms without letting wrong keys through.
const EXPERIMENTAL_MARGIN_DB = 5;

const parseKey = (text) => {
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 && value < fsk.MAX_FRAME_VALUE ? value : null;
};

const formatSeconds = (ms) => `${Math.max(0, Math.round(ms / 1000))} s`;
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

const LinkTest = () => {
  const [role, setRole] = useState("send");
  const [profileId, setProfileId] = useState("mid");
  const [keyText, setKeyText] = useState(DEFAULT_KEY);
  const [volume, setVolume] = useState(0.5);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState(null);
  const [stoppedAt, setStoppedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [screenLock, setScreenLock] = useState(false);

  // Sender
  const [framesPlayed, setFramesPlayed] = useState(0);
  // Receiver
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [level, setLevel] = useState(null);
  const [decoded, setDecoded] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [margins, setMargins] = useState([]);
  const [lastHeardAt, setLastHeardAt] = useState(null);
  const [firstHeardAt, setFirstHeardAt] = useState(null);
  const [rebuilt, setRebuilt] = useState(0);
  const [lowStats, setLowStats] = useState({ decoded: 0, wrong: 0 });
  const [distance, setDistance] = useState("");
  const [sentText, setSentText] = useState("");
  const [copied, setCopied] = useState(false);

  const audioRef = useRef(null);
  const receiverRef = useRef(null);
  const lowReceiverRef = useRef(null);
  const levelRef = useRef(null);
  const timerRef = useRef(null);
  const wakeRef = useRef(null);

  const profile = fsk.PROFILES[profileId];
  const keyValue = parseKey(keyText);

  const stop = useCallback(async () => {
    window.clearInterval(timerRef.current);
    timerRef.current = null;
    const audio = audioRef.current;
    audioRef.current = null;
    receiverRef.current = null;
    lowReceiverRef.current = null;
    audio?.transmitter?.stop();
    if (audio?.mic) await audio.mic.stop();
    else if (audio?.context) await audio.context.close().catch(() => {});
    await wakeRef.current?.release();
    wakeRef.current = null;
    setScreenLock(false);
    setRunning((wasRunning) => {
      if (wasRunning) setStoppedAt(Date.now());
      return false;
    });
  }, []);

  useEffect(() => () => {
    stop();
  }, [stop]);

  const resetCounters = () => {
    setFramesPlayed(0);
    setDecoded(0);
    setWrong(0);
    setMargins([]);
    setLastHeardAt(null);
    setFirstHeardAt(null);
    setRebuilt(0);
    setLowStats({ decoded: 0, wrong: 0 });
    setLevel(null);
    setCopied(false);
  };

  const start = async () => {
    if (keyValue === null) {
      setError(`The test key must be a whole number from 0 to ${fsk.MAX_FRAME_VALUE - 1}.`);
      return;
    }
    setError("");
    setStarting(true);
    resetCounters();
    try {
      wakeRef.current = await keepScreenOn();
      setScreenLock(wakeRef.current.active);

      if (role === "send") {
        const context = await createAudioContext();
        const transmitter = createTransmitter(context);
        transmitter.setFrame({ value: keyValue, profile });
        transmitter.start({ volume, gapMs: GAP_MS, onFramePlayed: () => setFramesPlayed((count) => count + 1) });
        audioRef.current = { context, transmitter };
        timerRef.current = window.setInterval(() => setNow(Date.now()), 500);
      } else {
        const mic = await openMic({
          onChunk: (chunk) => {
            receiverRef.current?.push(chunk);
            lowReceiverRef.current?.push(chunk);
            levelRef.current = levelDb(chunk);
          },
        });
        receiverRef.current = new FrameReceiver({ sampleRate: mic.sampleRate, profile });
        lowReceiverRef.current = new FrameReceiver({ sampleRate: mic.sampleRate, profile, detectionMarginDb: EXPERIMENTAL_MARGIN_DB });
        audioRef.current = { mic };
        setDeviceInfo({ sampleRate: mic.sampleRate, ...mic.settings });
        timerRef.current = window.setInterval(() => {
          setNow(Date.now());
          setLevel(levelRef.current);
          const lowFrames = lowReceiverRef.current?.scan() || [];
          if (lowFrames.length) {
            const lowCorrect = lowFrames.filter((frame) => frame.value === keyValue).length;
            setLowStats((stats) => ({ decoded: stats.decoded + lowCorrect, wrong: stats.wrong + lowFrames.length - lowCorrect }));
          }
          const frames = receiverRef.current?.scan() || [];
          if (frames.length === 0) return;
          const correct = frames.filter((frame) => frame.value === keyValue);
          setDecoded((count) => count + correct.length);
          setWrong((count) => count + frames.length - correct.length);
          setMargins((list) => [...list, ...correct.map((frame) => frame.minMarginDb)]);
          setRebuilt((count) => count + correct.filter((frame) => frame.combined).length);
          if (correct.length) {
            setLastHeardAt(Date.now());
            setFirstHeardAt((first) => first ?? Date.now());
          }
        }, SCAN_MS);
      }
      setStartedAt(Date.now());
      setStoppedAt(null);
      setNow(Date.now());
      setRunning(true);
    } catch (startError) {
      await stop();
      setError(startError.message || "Could not start audio. Check the microphone permission and try again.");
    } finally {
      setStarting(false);
    }
  };

  const changeVolume = (value) => {
    setVolume(value);
    audioRef.current?.transmitter?.setVolume(value);
  };

  const elapsedMs = startedAt ? (running ? now : stoppedAt ?? now) - startedAt : 0;
  const sentCount = Number(sentText) > 0 ? Number(sentText) : null;
  const rate = sentCount ? (decoded / sentCount) * 100 : null;
  const lowRate = sentCount ? (lowStats.decoded / sentCount) * 100 : null;
  const avgMargin = average(margins);
  const lowestMargin = margins.length ? Math.min(...margins) : null;

  const resultsText = [
    "MarkMePresent link test",
    `Role: ${role === "send" ? "sender" : "receiver"}`,
    `Band: ${profile.label} (${fsk.profileRange(profile)})`,
    `Key: ${keyText}`,
    role === "send" ? `Volume: ${Math.round(volume * 100)}%` : `Distance: ${distance || "not entered"}`,
    `Device: ${navigator.userAgent}`,
    ...(role === "send"
      ? [`Frames played: ${framesPlayed}`]
      : [
          deviceInfo ? `Sample rate: ${deviceInfo.sampleRate} Hz · filters off: echo ${deviceInfo.echoCancellationOff ? "yes" : "no"}, noise ${deviceInfo.noiseSuppressionOff ? "yes" : "no"}, auto gain ${deviceInfo.autoGainControlOff ? "yes" : "no"}` : "Sample rate: not started",
          `Listening time: ${formatSeconds(elapsedMs)}`,
          `Frames decoded (correct key): ${decoded}${rebuilt ? ` (${rebuilt} rebuilt from repeats)` : ""}`,
          `First key heard after: ${firstHeardAt && startedAt ? formatSeconds(firstHeardAt - startedAt) : "not heard"}`,
          `Wrong-key decodes: ${wrong}`,
          `Frames sent (from sender): ${sentCount ?? "not entered"}${rate !== null ? ` → ${rate.toFixed(1)}% decoded` : ""}`,
          `Signal margin per frame: ${avgMargin !== null ? `avg ${avgMargin.toFixed(1)} dB, lowest ${lowestMargin.toFixed(1)} dB` : "no frames yet"}`,
          `Experimental ${EXPERIMENTAL_MARGIN_DB} dB threshold: ${lowStats.decoded} decoded${lowRate !== null ? ` (${lowRate.toFixed(1)}%)` : ""}, ${lowStats.wrong} wrong-key`,
        ]),
  ].join("\n");

  const copyResults = async () => {
    try {
      await navigator.clipboard.writeText(resultsText);
      setCopied(true);
    } catch {
      setCopied(false);
      window.prompt("Copy these results:", resultsText);
    }
  };

  const levelPercent = level === null ? 0 : Math.min(100, Math.max(0, ((level + 90) / 90) * 100));

  return (
    <main className="acoustic-lab">
      <header className="acoustic-lab__header">
        <div>
          <Brand />
          <p className="acoustic-lab__eyebrow">Layer 1 · Phone-to-phone link</p>
          <h1>Link test</h1>
          <p>One phone sends a test key as near-ultrasonic tones; another phone listens and counts what it decodes. Nothing is saved.</p>
        </div>
        <Link to="/acoustic-lab" className="ui-btn ui-btn--secondary ui-btn--sm">Single-phone lab</Link>
      </header>

      <section className="acoustic-lab__notice">
        <h2>How to run it</h2>
        <p>
          Use two Android phones with current Chrome. Pick the <strong>same band and key</strong> on both. Start the receiver first, then the sender.
          Keep both screens on and the phones still. After about a minute, stop the sender, type its <em>frames played</em> number into the receiver, and copy the receiver’s results.
          Run it at 1 m, 6 m and the far corner of the room.
        </p>
      </section>

      {error && <p className="acoustic-lab__error" role="alert">{error}</p>}

      <section className="acoustic-lab__panel">
        <div className="link-settings">
          <div className="link-segment" role="group" aria-label="Role">
            {["send", "receive"].map((option) => (
              <button key={option} type="button" className={role === option ? "is-active" : ""} onClick={() => setRole(option)} disabled={running}>
                {option === "send" ? "Send" : "Receive"}
              </button>
            ))}
          </div>
          <div className="link-segment" role="group" aria-label="Band">
            {Object.values(fsk.PROFILES).map((option) => (
              <button key={option.id} type="button" className={profileId === option.id ? "is-active" : ""} onClick={() => setProfileId(option.id)} disabled={running}>
                {option.label} <small>{fsk.profileRange(option)}</small>
              </button>
            ))}
          </div>
          <label className="link-field">
            Test key
            <input className="ui-input" inputMode="numeric" value={keyText} onChange={(event) => setKeyText(event.target.value.trim())} disabled={running} />
          </label>
          {role === "send" ? (
            <label className="link-field">
              Volume {Math.round(volume * 100)}%
              <input type="range" min="0.05" max="1" step="0.05" value={volume} onChange={(event) => changeVolume(Number(event.target.value))} />
            </label>
          ) : (
            <label className="link-field">
              Distance between phones
              <input className="ui-input" placeholder="e.g. 1 m" value={distance} onChange={(event) => setDistance(event.target.value)} />
            </label>
          )}
        </div>

        <div className="acoustic-lab__controls">
          {!running ? (
            <Button onClick={start} loading={starting} disabled={keyValue === null}>
              {role === "send" ? "Start sending" : "Start listening"}
            </Button>
          ) : (
            <Button variant="danger" onClick={stop}>Stop</Button>
          )}
          {running && <Badge variant={screenLock ? "success" : "warning"}>{screenLock ? "Screen kept on" : "Keep the screen on manually"}</Badge>}
        </div>
      </section>

      {role === "send" && (running || framesPlayed > 0) && (
        <section className="acoustic-lab__panel">
          <h2>Sending</h2>
          <div className="link-stats">
            <div><span>Frames played</span><strong>{framesPlayed}</strong></div>
            <div><span>Time</span><strong>{formatSeconds(elapsedMs)}</strong></div>
            <div><span>Band</span><strong>{fsk.profileRange(profile)}</strong></div>
          </div>
          <p className="ui-muted">Each frame lasts {(fsk.SYMBOL_COUNT * fsk.SYMBOL_DURATION_MS / 1000).toFixed(2)} s with a {GAP_MS} ms pause, about {Math.round(60 / (fsk.SYMBOL_COUNT * fsk.SYMBOL_DURATION_MS / 1000 + GAP_MS / 1000))} frames per minute.</p>
        </section>
      )}

      {role === "receive" && (running || decoded + wrong > 0 || deviceInfo) && (
        <section className="acoustic-lab__panel">
          <h2>Listening</h2>
          {deviceInfo && (
            <p className="ui-muted">
              {deviceInfo.sampleRate} Hz · echo cancel {deviceInfo.echoCancellationOff ? "off" : "ON"} · noise suppression {deviceInfo.noiseSuppressionOff ? "off" : "ON"} · auto gain {deviceInfo.autoGainControlOff ? "off" : "ON"}
            </p>
          )}
          <div className="link-level" aria-label="Microphone level">
            <span style={{ width: `${levelPercent}%` }} />
          </div>
          <div className="link-stats">
            <div><span>Decoded (correct key)</span><strong>{decoded}</strong></div>
            <div><span>Rebuilt from repeats</span><strong>{rebuilt}</strong></div>
            <div><span>First key heard after</span><strong>{firstHeardAt && startedAt ? formatSeconds(firstHeardAt - startedAt) : "—"}</strong></div>
            <div><span>Wrong-key decodes</span><strong>{wrong}</strong></div>
            <div><span>Time</span><strong>{formatSeconds(elapsedMs)}</strong></div>
            <div><span>Avg margin</span><strong>{avgMargin !== null ? `${avgMargin.toFixed(1)} dB` : "—"}</strong></div>
          </div>
          <div className="link-stats link-stats--experimental">
            <div><span>At {EXPERIMENTAL_MARGIN_DB} dB threshold (experiment)</span><strong>{lowStats.decoded}</strong></div>
            <div><span>Wrong-key at {EXPERIMENTAL_MARGIN_DB} dB</span><strong>{lowStats.wrong}</strong></div>
          </div>
          <p className="ui-muted">
            {lastHeardAt ? `Last frame heard ${formatSeconds(now - lastHeardAt)} ago.` : running ? "Waiting for the first frame…" : ""}
          </p>
          <label className="link-field link-field--inline">
            Frames played on the sender
            <input className="ui-input" inputMode="numeric" value={sentText} onChange={(event) => setSentText(event.target.value.replace(/\D/g, ""))} placeholder="from the other phone" />
          </label>
          {rate !== null && (
            <p className={`link-rate ${rate >= 95 ? "link-rate--pass" : "link-rate--fail"}`}>
              {rate.toFixed(1)}% decoded {rate >= 95 ? "— meets the 95% target" : "— below the 95% target"}
            </p>
          )}
        </section>
      )}

      {(framesPlayed > 0 || decoded + wrong > 0 || deviceInfo) && (
        <section className="acoustic-lab__panel">
          <h2>Results</h2>
          <pre className="link-results">{resultsText}</pre>
          <div className="acoustic-lab__controls">
            <Button variant="secondary" onClick={copyResults}>{copied ? "Copied ✓" : "Copy results"}</Button>
          </div>
        </section>
      )}
    </main>
  );
};

export default LinkTest;
