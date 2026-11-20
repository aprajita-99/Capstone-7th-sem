/**
 * Cascade relay plan (FEATURES.md Phase 6), kept pure for unit tests.
 *
 * A phone that heard a key of wave k is a wave k+1 student. If waves remain,
 * it relays the key of wave k+1. Every phone of the same wave plays at the same
 * shared slot boundaries (server clock), so identical signals add instead of
 * colliding. A frame (~1.32 s) fits inside one slot.
 */
const SLOT_MS = 2000;
const RELAY_REPEATS = 5; // more repeats = more chances for back rows to decode or combine
const LEAD_MS = 2500; // time for the response to reach the phone (via Vercel → Render) and audio to be scheduled

const studentWave = (keyWave) => keyWave + 1;

// null when the cascade has reached its last wave; otherwise { wave, playAt[] }.
const relayPlan = ({ keyWave, maxWaves, now = Date.now(), slotMs = SLOT_MS, repeats = RELAY_REPEATS, leadMs = LEAD_MS }) => {
  const wave = studentWave(keyWave);
  if (wave >= maxWaves) return null;
  const firstSlot = Math.ceil((now + leadMs) / slotMs) * slotMs;
  return { wave, playAt: Array.from({ length: repeats }, (_, index) => firstSlot + index * slotMs) };
};

module.exports = { SLOT_MS, RELAY_REPEATS, LEAD_MS, studentWave, relayPlan };
