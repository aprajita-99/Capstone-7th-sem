/**
 * Identity enrollment rules (FEATURES.md Phase 8), kept pure for unit tests.
 */
const MAX_ATTEMPTS = 3;
const CONSENT_VERSION = "2026-10-v1";

// "2023UGCS111" from "2023ugcs111@nitjsr.ac.in".
const loginIdFromEmail = (email) => String(email || "").split("@")[0].toUpperCase();

const squash = (text) => String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// True when the ID card text contains the login id, ignoring spaces, case and punctuation.
const textContainsRoll = (lines, loginId) => {
  const needle = squash(loginId);
  if (!needle) return false;
  return squash((lines || []).join(" ")).includes(needle);
};

/**
 * Decide an enrollment from AWS results.
 *  - not live → failed (likely a photo/screen; the attempt is used, student may retry)
 *  - live + strong match + roll ok (or test account) → verified
 *  - otherwise → pending for a teacher, with reasons
 */
const enrollmentDecision = ({ livenessVerdict, matchDecision, rollMatch, testAccount = false }) => {
  if (livenessVerdict !== "live") return { outcome: "failed", reasons: [livenessVerdict === "not_live" ? "not_live" : "liveness_incomplete"] };
  const reasons = [];
  if (matchDecision === "unsure") reasons.push("face_unsure");
  if (matchDecision === "no_match") reasons.push("face_mismatch");
  if (!testAccount && rollMatch !== true) reasons.push(rollMatch === false ? "roll_mismatch" : "roll_unchecked");
  return reasons.length === 0 ? { outcome: "verified", reasons } : { outcome: "pending", reasons };
};

// data:image/jpeg;base64,... → { contentType, buffer } or null (JPEG/PNG only: what Rekognition accepts).
const parseImageDataUrl = (dataUrl, maxBytes = 700 * 1024) => {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) return { error: "Send a JPEG or PNG image" };
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0) return { error: "The image is empty" };
  if (buffer.length > maxBytes) return { error: "The image is too large (max 600 KB after compression)" };
  return { contentType: match[1], buffer };
};

module.exports = { MAX_ATTEMPTS, CONSENT_VERSION, loginIdFromEmail, textContainsRoll, enrollmentDecision, parseImageDataUrl };
