// Microphone capture for the key tones. Phone speech filters would erase the
// tones, so echo cancellation, noise suppression and auto gain are switched
// off, and the browser's applied settings are reported back.
export const MIN_SAMPLE_RATE = 44100;

export const createAudioContext = async () => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser has no Web Audio support. Use current Chrome on Android.");
  const context = new AudioContextClass();
  await context.resume();
  if (context.sampleRate < MIN_SAMPLE_RATE) {
    await context.close();
    throw new Error(`This phone's audio runs at ${context.sampleRate} Hz; at least ${MIN_SAMPLE_RATE} Hz is needed for the key tones.`);
  }
  return context;
};

// onChunk(Float32Array) receives ~43 ms of mono samples at a time.
export const openMic = async ({ onChunk }) => {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access needs HTTPS (or localhost) and a browser that allows it.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  let context;
  try {
    context = await createAudioContext();
    if (!context.audioWorklet) throw new Error("This browser does not support AudioWorklet. Use current Chrome on Android.");
    await context.audioWorklet.addModule(`${process.env.PUBLIC_URL}/capture-worklet.js`);

    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const silentSink = context.createGain();
    silentSink.gain.value = 0; // keeps the graph running without playing the mic back
    capture.port.onmessage = ({ data }) => onChunk(data);
    source.connect(capture);
    capture.connect(silentSink);
    silentSink.connect(context.destination);

    const settings = stream.getAudioTracks()[0]?.getSettings?.() || {};
    return {
      context,
      sampleRate: context.sampleRate,
      settings: {
        echoCancellationOff: settings.echoCancellation === false,
        noiseSuppressionOff: settings.noiseSuppression === false,
        autoGainControlOff: settings.autoGainControl === false,
        channelCount: settings.channelCount,
      },
      stop: async () => {
        capture.port.onmessage = null;
        source.disconnect();
        capture.disconnect();
        silentSink.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        await context.close().catch(() => {});
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    if (context) await context.close().catch(() => {});
    throw error;
  }
};

// RMS level of a chunk in dBFS (0 = full scale).
export const levelDb = (chunk) => {
  let sum = 0;
  for (let index = 0; index < chunk.length; index += 1) sum += chunk[index] * chunk[index];
  return 10 * Math.log10(Math.max(sum / chunk.length, 1e-12));
};
