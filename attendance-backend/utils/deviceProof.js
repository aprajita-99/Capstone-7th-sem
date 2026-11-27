/**
 * Device proof: a student's browser signs a one-time server nonce with the
 * private key it keeps in IndexedDB, so the server knows a request really
 * comes from the device bound to that student.
 *
 * Message signed (UTF-8): `${purpose}|${nonce}|${payloadHash}`
 *   payloadHash = SHA-256 hex of canonicalJson(payload), where payload holds
 *   the request fields that must not be swapped (e.g. { sessionId, key }).
 * Signature: ECDSA P-256 / SHA-256, raw r||s (WebCrypto's format), base64url.
 * The frontend mirror lives in attendance-frontend/src/utils/deviceKey.js.
 */
const crypto = require("crypto");
const DeviceChallenge = require("../models/deviceChallengeModels");
const { isDevMode } = require("./devMode");

const CHALLENGE_TTL_MS = 60 * 1000;
const PURPOSES = ["bind", "claim", "face", "neighbour"];

// JSON with object keys sorted at every level, so both sides hash identical bytes.
const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
};

const buildProofMessage = (purpose, nonce, payload = {}) => {
  const payloadHash = crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
  return `${purpose}|${nonce}|${payloadHash}`;
};

// True only for a valid raw (IEEE P1363) ECDSA P-256 signature by this key.
const verifySignature = (publicKeyJwk, message, signature) => {
  if (!publicKeyJwk || publicKeyJwk.kty !== "EC" || publicKeyJwk.crv !== "P-256") return false;
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]+$/.test(signature)) return false;
  try {
    const key = crypto.createPublicKey({
      key: { kty: "EC", crv: "P-256", x: publicKeyJwk.x, y: publicKeyJwk.y },
      format: "jwk",
    });
    return crypto.verify("sha256", Buffer.from(message, "utf8"), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
};

const issueChallenge = async (userId, purpose) => {
  const challenge = await DeviceChallenge.create({
    user: userId,
    purpose,
    nonce: crypto.randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  return { challengeId: challenge._id, nonce: challenge.nonce, expiresAt: challenge.expiresAt };
};

/**
 * Consume the challenge (once) and check the signature.
 * publicKeyJwk defaults to the user's bound key; binding passes the new key.
 * Returns { ok: true } or { ok: false, reason }.
 */
const verifyDeviceProof = async ({ user, challengeId, signature, purpose, payload = {}, publicKeyJwk }) => {
  if (!challengeId || !signature) return { ok: false, reason: "Device proof is missing" };

  // The bound phone's key; in dev mode also every other browser the student signed in on.
  const keys = publicKeyJwk
    ? [publicKeyJwk]
    : [user.deviceBinding?.publicKeyJwk, ...(isDevMode() ? (user.deviceBinding?.devKeys || []).map((entry) => entry?.publicKeyJwk) : [])].filter(Boolean);
  if (keys.length === 0) return { ok: false, reason: "This browser is not bound to your account" };

  let challenge;
  try {
    // Claim the challenge atomically so it can never be used twice.
    challenge = await DeviceChallenge.findOneAndUpdate(
      { _id: challengeId, user: user._id, purpose, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true }
    );
  } catch {
    challenge = null; // malformed id
  }
  if (!challenge) return { ok: false, reason: "Device check expired, please try again" };

  const message = buildProofMessage(purpose, challenge.nonce, payload);
  if (!keys.some((key) => verifySignature(key, message, signature))) {
    return { ok: false, reason: "Device signature could not be verified" };
  }
  return { ok: true };
};

module.exports = {
  CHALLENGE_TTL_MS,
  PURPOSES,
  canonicalJson,
  buildProofMessage,
  verifySignature,
  issueChallenge,
  verifyDeviceProof,
};
