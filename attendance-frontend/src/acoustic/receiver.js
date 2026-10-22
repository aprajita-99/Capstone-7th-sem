/**
 * Streaming frame receiver (no Web Audio here, so Node tests can drive it).
 *
 * Mic samples are pushed in chunks into a ring buffer; scan() searches the
 * recent audio for complete frames with fsk.decodeFrame and returns each new
 * frame exactly once. After a frame is found, later scans start after its
 * end, so a repeated key is counted once per transmission, never twice.
 *
 * Repeat combining: when no single frame passes (each repeat loses a
 * different weak symbol), the per-symbol readings of recent repeats are
 * merged with fsk.combineReadings. The checksum rejects merges of different
 * keys, and the server only accepts keys it issued, so this can only help an
 * honest phone hear the key; frames found this way carry combined: true.
 *
 * Plain CommonJS like fsk.js, so the same file runs in Node and in the app.
 */
const fsk = require("./fsk");

const COMBINE_WINDOW_S = 12; // keys rotate slower than this, so repeats share one key
const MAX_READINGS = 8;

class FrameReceiver {
  constructor({ sampleRate, profile = fsk.DEFAULT_PROFILE, bufferSeconds = 2.4, detectionMarginDb, combineRepeats = true } = {}) {
    if (!sampleRate) throw new Error("sampleRate is required");
    this.sampleRate = sampleRate;
    this.profile = profile;
    this.detectionMarginDb = detectionMarginDb;
    this.combineRepeats = combineRepeats;
    this.capacity = Math.round(sampleRate * bufferSeconds);
    this.ring = new Float32Array(this.capacity);
    this.linear = new Float32Array(this.capacity);
    this.symbolSamples = Math.round((sampleRate * fsk.SYMBOL_DURATION_MS) / 1000);
    this.frameSamples = this.symbolSamples * fsk.SYMBOL_COUNT;
    this.reset();
  }

  reset() {
    this.writeIndex = 0;
    this.filled = 0;
    this.totalSamples = 0; // absolute count of samples ever pushed
    this.lastFrameEnd = 0; // absolute sample index where the last decoded frame ended
    this.readings = []; // [{ startSample, symbols }] of recent frames that did not decode alone
  }

  push(chunk) {
    for (let index = 0; index < chunk.length; index += 1) {
      this.ring[this.writeIndex] = chunk[index];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
    }
    this.filled = Math.min(this.capacity, this.filled + chunk.length);
    this.totalSamples += chunk.length;
  }

  // Copy the ring into time order; returns the absolute index of linear[0].
  linearize() {
    const start = (this.writeIndex - this.filled + this.capacity) % this.capacity;
    const firstPart = Math.min(this.filled, this.capacity - start);
    this.linear.set(this.ring.subarray(start, start + firstPart), 0);
    if (firstPart < this.filled) this.linear.set(this.ring.subarray(0, this.filled - firstPart), firstPart);
    return this.totalSamples - this.filled;
  }

  // Returns [{ value, dataDigits, margins, minMarginDb, startSample, endSample }].
  scan() {
    const frames = [];
    if (this.filled < this.frameSamples) return frames;

    const bufferStart = this.linearize();
    let from = Math.max(0, this.lastFrameEnd - bufferStart);

    while (this.filled - from >= this.frameSamples) {
      const decoded = fsk.decodeFrame(this.linear.subarray(from, this.filled), this.sampleRate, {
        profile: this.profile,
        detectionMarginDb: this.detectionMarginDb,
      });
      if (!decoded) break;

      const startSample = bufferStart + from + decoded.frameStartSample;
      const endSample = startSample + this.frameSamples;
      frames.push({
        value: fsk.digitsToValue(decoded.dataDigits),
        dataDigits: decoded.dataDigits,
        margins: decoded.margins,
        minMarginDb: Math.min(...decoded.margins),
        startSample,
        endSample,
      });
      this.lastFrameEnd = endSample;
      from = endSample - bufferStart;
    }

    if (this.combineRepeats) {
      const combined = this.combineRecentRepeats(bufferStart, from);
      if (combined) frames.push(combined);
    }
    return frames;
  }

  // Store readings of marker-aligned frames that failed alone, then try to merge them.
  combineRecentRepeats(bufferStart, from) {
    const region = this.linear.subarray(from, this.filled);
    const options = { profile: this.profile, detectionMarginDb: this.detectionMarginDb };

    for (const group of fsk.findFrameStarts(region, this.sampleRate, options)) {
      let best = null;
      for (const start of group) {
        const symbols = fsk.measureFrameAt(region, this.sampleRate, start, options);
        if (!symbols || symbols[0].tone !== fsk.MARKER_TONE || symbols[1].tone !== fsk.MARKER_TONE) continue;
        const score = symbols.reduce((sum, symbol) => sum + symbol.margin, 0);
        if (!best || score > best.score) best = { start, symbols, score };
      }
      if (!best) continue;
      const startSample = bufferStart + from + best.start;
      if (this.readings.some((reading) => Math.abs(reading.startSample - startSample) < this.symbolSamples / 2)) continue;
      this.readings.push({ startSample, symbols: best.symbols });
    }

    const oldest = this.totalSamples - COMBINE_WINDOW_S * this.sampleRate;
    this.readings = this.readings
      .filter((reading) => reading.startSample >= oldest && reading.startSample >= this.lastFrameEnd)
      .slice(-MAX_READINGS);
    if (this.readings.length < 2) return null;

    const decoded = fsk.combineReadings(this.readings.map((reading) => reading.symbols), options);
    if (!decoded) return null;

    const latest = this.readings[this.readings.length - 1];
    const frame = {
      value: fsk.digitsToValue(decoded.dataDigits),
      dataDigits: decoded.dataDigits,
      margins: decoded.margins,
      minMarginDb: Math.min(...decoded.margins),
      startSample: latest.startSample,
      endSample: latest.startSample + this.frameSamples,
      combined: true,
      repeatsUsed: this.readings.length,
    };
    this.lastFrameEnd = frame.endSample;
    this.readings = [];
    return frame;
  }
}

module.exports = { FrameReceiver };
