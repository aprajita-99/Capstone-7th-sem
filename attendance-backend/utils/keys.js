/**
 * Session keys: short-lived numbers the server mints and phones play as sound
 * (7 base-15 digits → 0 … 15^7 − 1, matching the frontend codec).
 * Phones never invent keys; a claim is accepted only for a key this session issued.
 */
const crypto = require("crypto");
const WaveKey = require("../models/waveKeyModels");

const KEY_SPACE = 15 ** 7;

const mintKey = () => crypto.randomInt(KEY_SPACE);

/**
 * A key is accepted from when it starts playing until one extra lifetime after
 * it stops (a phone may decode the last repeat just before rotation and then
 * need a few seconds to sign and send its claim).
 */
const isKeyAcceptable = (key, now = new Date(), graceMs = 0) =>
  Boolean(key) && key.validFrom.getTime() <= now.getTime() && key.validUntil.getTime() + graceMs > now.getTime();

// The live key for a wave, minting a fresh one when the last has expired.
const currentKey = async (session, wave = 0, now = new Date()) => {
  const live = await WaveKey.findOne({ session: session._id, wave, validUntil: { $gt: now } }).sort({ validUntil: -1 });
  if (live) return live;

  const lifetimeMs = (session.settings?.keyLifetimeSec || 15) * 1000;
  return WaveKey.create({ session: session._id, wave, value: mintKey(), validFrom: now, validUntil: new Date(now.getTime() + lifetimeMs) });
};

// The issued key matching `value` if it is still acceptable, else null.
const findKey = async (session, value, now = new Date()) => {
  if (!Number.isInteger(value) || value < 0 || value >= KEY_SPACE) return null;
  const graceMs = (session.settings?.keyLifetimeSec || 15) * 1000;
  const candidates = await WaveKey.find({ session: session._id, value }).sort({ validUntil: -1 }).limit(3);
  return candidates.find((key) => isKeyAcceptable(key, now, graceMs)) || null;
};

module.exports = { KEY_SPACE, mintKey, isKeyAcceptable, currentKey, findKey };
