/**
 * The server's attendance decision (FEATURES.md §3.6–3.7), kept pure so it
 * can be unit-tested. Later phases add inputs (face, enrollment, neighbours)
 * without changing these outputs.
 *
 * - heard a valid key, signed by the bound device → present
 * - joined but never heard a key → review (not_heard): never silently absent
 * - never joined → absent
 */
const decide = ({ joined = false, heard = false, deviceVerified = false } = {}) => {
  if (heard && deviceVerified) return { status: "present", reasons: [] };
  if (joined || heard) return { status: "review", reasons: [heard ? "device_unverified" : "not_heard"] };
  return { status: "absent", reasons: ["not_joined"] };
};

module.exports = { decide };
