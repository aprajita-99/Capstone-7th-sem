/**
 * Node tests for the streaming receiver and the band profiles (Layer 1, Phase 4).
 * Run with: npm run test:acoustic
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fsk = require("./fsk");
const { FrameReceiver } = require("./receiver");

const SAMPLE_RATE = 48000;
const CHUNK = 2048; // what the capture worklet posts
const SCAN_EVERY_CHUNKS = 12; // ~0.5 s at 48 kHz, like the app

const makeRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

// Frames separated by gaps, optional white noise at a given SNR (dB) over the frames.
const buildStream = ({ values, profile, gapMs = 300, leadMs = 400, snrDb = null, seed = 1 }) => {
  const random = makeRandom(seed);
  const gap = Math.round((SAMPLE_RATE * gapMs) / 1000);
  const frames = values.map((value) => fsk.encodeFrame(fsk.valueToDigits(value), SAMPLE_RATE, { profile, amplitude: 0.5 }).samples);
  const lead = Math.round((SAMPLE_RATE * leadMs) / 1000);
  const total = lead + frames.reduce((sum, frame) => sum + frame.length + gap, 0) + SAMPLE_RATE;
  const stream = new Float32Array(total);
  let offset = lead;
  for (const frame of frames) {
    stream.set(frame, offset);
    offset += frame.length + gap;
  }
  if (snrDb != null) {
    const noiseRms = 0.5 / Math.SQRT2 / 10 ** (snrDb / 20);
    for (let index = 0; index < stream.length; index += 1) stream[index] += (random() * 2 - 1) * noiseRms * Math.sqrt(3);
  }
  return stream;
};

const runReceiver = (stream, profile) => {
  const receiver = new FrameReceiver({ sampleRate: SAMPLE_RATE, profile });
  const found = [];
  let chunks = 0;
  for (let start = 0; start < stream.length; start += CHUNK) {
    receiver.push(stream.subarray(start, Math.min(stream.length, start + CHUNK)));
    chunks += 1;
    if (chunks % SCAN_EVERY_CHUNKS === 0) found.push(...receiver.scan());
  }
  found.push(...receiver.scan());
  return found;
};

test("profiles: high is the plan.md default, mid sits 1.5 kHz lower with the same layout", () => {
  assert.equal(fsk.toneFrequency(0), 18000);
  assert.equal(fsk.toneFrequency(0, fsk.PROFILES.mid), 16500);
  assert.equal(fsk.toneFrequency(16, fsk.PROFILES.mid), 18260);
  assert.equal(fsk.profileRange(fsk.PROFILES.mid), "16.50–18.26 kHz");
  assert.equal(fsk.profileRange(), "18.00–19.76 kHz");
});

test("mid profile: 200 random keys encode and decode, and never decode as high", () => {
  const random = makeRandom(11);
  let decoded = 0;
  let crossDecoded = 0;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const digits = Array.from({ length: fsk.DATA_SYMBOL_COUNT }, () => Math.floor(random() * fsk.DIGIT_RADIX));
    const frame = fsk.encodeFrame(digits, SAMPLE_RATE, { profile: "mid" });
    const result = fsk.decodeFrame(frame.samples, SAMPLE_RATE, { expectedStartSample: 0, profile: "mid" });
    if (result && fsk.digitsToValue(result.dataDigits) === fsk.digitsToValue(digits)) decoded += 1;
    if (fsk.decodeFrame(frame.samples, SAMPLE_RATE, { expectedStartSample: 0, profile: "high" })) crossDecoded += 1;
  }
  console.log(`[mid] clean: ${decoded}/200 decoded; decoded with the wrong (high) profile: ${crossDecoded}/200`);
  assert.equal(decoded, 200);
  assert.equal(crossDecoded, 0);
});

test("receiver: a repeated key streamed in 2048-sample chunks is counted once per frame", () => {
  const values = Array(6).fill(1234567);
  const found = runReceiver(buildStream({ values, profile: fsk.PROFILES.high }), fsk.PROFILES.high);
  console.log(`[receiver] repeated key: ${found.length}/6 frames, values ${[...new Set(found.map((f) => f.value))]}`);
  assert.equal(found.length, 6);
  assert.ok(found.every((frame) => frame.value === 1234567));
  for (let index = 1; index < found.length; index += 1) assert.ok(found[index].startSample >= found[index - 1].endSample);
});

test("receiver: different keys back to back with short gaps, mid band, 10 dB noise", () => {
  const random = makeRandom(5);
  const values = Array.from({ length: 8 }, () => Math.floor(random() * fsk.MAX_FRAME_VALUE));
  const found = runReceiver(buildStream({ values, profile: fsk.PROFILES.mid, gapMs: 120, snrDb: 10, seed: 9 }), fsk.PROFILES.mid);
  console.log(`[receiver] mid, 120 ms gaps, 10 dB SNR: ${found.length}/8 frames, ${found.filter((f, i) => f.value === values[i]).length} in order`);
  assert.deepEqual(found.map((frame) => frame.value), values);
});

test("receiver: silence and the wrong band produce no frames", () => {
  assert.equal(runReceiver(new Float32Array(SAMPLE_RATE * 5), fsk.PROFILES.high).length, 0);
  const highStream = buildStream({ values: [42, 43, 44], profile: fsk.PROFILES.high });
  assert.equal(runReceiver(highStream, fsk.PROFILES.mid).length, 0);
});
