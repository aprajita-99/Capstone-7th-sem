// Plays one key frame on repeat. The frame is rendered once by fsk.encodeFrame
// (6 ms fades included) and scheduled ahead on the AudioContext clock, so
// playback timing does not depend on JavaScript timers.
import fsk from "./fsk";

const SCHEDULE_AHEAD_S = 1.5;
const TICK_MS = 250;

export const createTransmitter = (context) => {
  const gain = context.createGain();
  gain.connect(context.destination);

  let buffer = null;
  let timer = null;
  let nextTime = 0;
  let gapS = 0.3;
  let onPlayed = null;
  const scheduled = new Set();

  const setFrame = ({ value, profile }) => {
    const frame = fsk.encodeFrame(fsk.valueToDigits(value), context.sampleRate, { profile });
    buffer = context.createBuffer(1, frame.samples.length, context.sampleRate);
    buffer.copyToChannel(frame.samples, 0);
  };

  const handleEnded = (source) => {
    scheduled.delete(source);
    source.disconnect();
    if (timer) onPlayed?.(); // not counted when stopped early
  };

  const scheduleAhead = () => {
    while (buffer && nextTime < context.currentTime + SCHEDULE_AHEAD_S) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.onended = () => handleEnded(source);
      source.start(nextTime);
      scheduled.add(source);
      nextTime += buffer.duration + gapS;
    }
  };

  return {
    setFrame,
    setVolume: (volume) => gain.gain.setTargetAtTime(volume, context.currentTime, 0.02),
    get frameSeconds() {
      return buffer ? buffer.duration : 0;
    },
    start: ({ volume = 0.5, gapMs = 300, onFramePlayed } = {}) => {
      gain.gain.value = volume;
      gapS = gapMs / 1000;
      onPlayed = onFramePlayed;
      nextTime = context.currentTime + 0.1;
      scheduleAhead();
      timer = window.setInterval(scheduleAhead, TICK_MS);
    },
    stop: () => {
      window.clearInterval(timer);
      timer = null;
      scheduled.forEach((source) => {
        try {
          source.stop();
        } catch {
          // already stopped
        }
      });
      scheduled.clear();
    },
  };
};
