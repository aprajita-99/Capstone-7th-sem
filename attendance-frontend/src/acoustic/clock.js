// Server clock for relay playback (Phase 6): phones of the same wave start at
// the same server-time slot so their identical signals add up.

// Offset (server − local, ms) from the lowest-latency of a few /time round trips.
export const syncServerClock = async (fetchServerNow, samples = 3) => {
  let best = null;
  for (let index = 0; index < samples; index += 1) {
    const sentAt = Date.now();
    const serverNow = await fetchServerNow();
    const receivedAt = Date.now();
    const roundTripMs = receivedAt - sentAt;
    const offsetMs = serverNow - (sentAt + receivedAt) / 2;
    if (!best || roundTripMs < best.roundTripMs) best = { offsetMs, roundTripMs };
  }
  return best;
};

// AudioContext time at which to start so sound leaves the speaker at serverMs.
export const serverToContextTime = (context, serverMs, offsetMs) => {
  const localMs = serverMs - offsetMs;
  const outputLatency = context.outputLatency || context.baseLatency || 0;
  return context.currentTime + (localMs - Date.now()) / 1000 - outputLatency;
};
