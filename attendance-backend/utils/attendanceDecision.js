/**
 * The server's attendance decision (FEATURES.md §3.6–3.7), kept pure so it
 * can be unit-tested.
 *
 * Sound only (faceRequired false, Phase 5 behaviour):
 * - heard a valid key, signed by the bound device → present
 * - joined but never heard a key → review (not_heard): never silently absent
 * - never joined → absent
 *
 * With the face check (Phase 9, every new check-in):
 * - heard + face passed → present
 * - heard + face not done yet (or a retry is left) → heard (still in progress)
 * - heard + face mismatch → review (face_mismatch), no retry
 * - heard + face unsure / not live / missing and no retry left (or the face
 *   step is over) → review (face_unsure / face_not_live / face_missing)
 *
 * face: { status: "passed" | "unsure" | "mismatch" | "not_live" | "missing" }
 * faceFinal: true when no further face attempt is possible (out of tries,
 * student skipped, or the 2-minute grace after closing has passed).
 */
const FACE_REASON = { unsure: "face_unsure", mismatch: "face_mismatch", not_live: "face_not_live", missing: "face_missing" };

const decide = ({ joined = false, heard = false, deviceVerified = false, faceRequired = false, face = null, faceFinal = false } = {}) => {
  if (heard && deviceVerified) {
    if (!faceRequired) return { status: "present", reasons: [] };
    const faceStatus = face?.status;
    if (faceStatus === "passed") return { status: "present", reasons: [] };
    if (faceStatus === "mismatch") return { status: "review", reasons: [FACE_REASON.mismatch] };
    if (faceFinal) return { status: "review", reasons: [FACE_REASON[faceStatus] || FACE_REASON.missing] };
    return { status: "heard", reasons: faceStatus ? [FACE_REASON[faceStatus]] : [] };
  }
  if (joined || heard) return { status: "review", reasons: [heard ? "device_unverified" : "not_heard"] };
  return { status: "absent", reasons: ["not_joined"] };
};

// Map an AWS liveness verdict + face-match decision to a check-in face status.
const faceStatusFrom = (livenessVerdict, matchDecision) => {
  if (livenessVerdict !== "live") return "not_live";
  if (matchDecision === "match") return "passed";
  if (matchDecision === "unsure") return "unsure";
  return "mismatch";
};

module.exports = { decide, faceStatusFrom, FACE_REASON };
