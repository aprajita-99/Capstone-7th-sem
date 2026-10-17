/**
 * Streaming frame receiver (no Web Audio here, so Node tests can drive it).
 *
 * Mic samples are pushed in chunks into a ring buffer; scan() searches the
 * recent audio for complete frames with fsk.decodeFrame and returns each new
 * frame exactly once. After a frame is found, later scans start after its
 * end, so a repeated key is counted once per transmission, never twice.
 *
 * Plain CommonJS like fsk.js, so the same file runs in Node and in the app.
 */
const fsk = require("./fsk");

class FrameReceiver {
  constructor({ sampleRate, profile = fsk.DEFAULT_PROFILE, bufferSeconds = 2.4, detectionMarginDb } = {}) {
    if (!sampleRate) throw new Error("sampleRate is required");
    this.sampleRate = sampleRate;
    this.profile = profile;
    this.detectionMarginDb = detectionMarginDb;
    this.capacity = Math.round(sampleRate * bufferSeconds);
    this.ring = new Float32Array(this.capacity);
    this.linear = new Float32Array(this.capacity);
    this.frameSamples = Math.round((sampleRate * fsk.SYMBOL_DURATION_MS) / 1000) * fsk.SYMBOL_COUNT;
    this.reset();
  }

  reset() {
    this.writeIndex = 0;
    this.filled = 0;
    this.totalSamples = 0; // absolute count of samples ever pushed
    this.lastFrameEnd = 0; // absolute sample index where the last decoded frame ended
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

    return frames;
  }
}

module.exports = { FrameReceiver };
