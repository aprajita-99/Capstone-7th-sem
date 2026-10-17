// Forwards raw microphone samples to the main thread in 2048-sample chunks
// (about 43 ms at 48 kHz). Decoding happens on the main thread (receiver.js).
const CHUNK_SIZE = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CHUNK_SIZE);
    this.index = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let sample = 0; sample < input.length; sample += 1) {
      this.buffer[this.index] = input[sample];
      this.index += 1;
      if (this.index === CHUNK_SIZE) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(CHUNK_SIZE);
        this.index = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
