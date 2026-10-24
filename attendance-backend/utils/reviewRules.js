/**
 * Phase 10 rules for changing attendance after the sound + face decision,
 * kept pure so they can be unit-tested.
 *
 * - A check-in locks at session.lockAt (09:00 the next morning); after that
 *   nothing changes.
 * - Teacher decisions: a `review` record → present / absent (kind review, or
 *   query when the student raised one). A `present` / `absent` record → the
 *   other status with a required note (kind override).
 * - Student query: once per record, on `absent` or `review` records the
 *   teacher has not decided yet, until the lock.
 * - At the lock, records still in review become absent (reason unresolved).
 */
const QUERY_REASONS = ["cant_hear", "camera_failed", "was_present", "other"];
const QUERY_TEXT_MAX = 300;
const TEACHER_KINDS = ["review", "query", "override"];

const isLocked = (session, now = Date.now()) =>
  session?.status === "locked" || Boolean(session?.lockAt && new Date(now).getTime() >= new Date(session.lockAt).getTime());

const teacherDecided = (record) => TEACHER_KINDS.includes(record?.decision?.kind) || Boolean(record?.decision?.by);

const canQuery = (record, session, now = Date.now()) => {
  if (!record) return { ok: false, code: "no_record" };
  if (isLocked(session, now)) return { ok: false, code: "locked" };
  if (record.query?.raisedAt) return { ok: false, code: "already_queried" };
  if (!["absent", "review"].includes(record.status)) return { ok: false, code: "not_queryable" };
  if (teacherDecided(record)) return { ok: false, code: "teacher_decided" };
  return { ok: true };
};

// Teacher's decision on one record → { ok, kind } or { ok:false, code, status (HTTP) }.
const canDecide = (record, session, status, note = "", now = Date.now()) => {
  if (!["present", "absent"].includes(status)) return { ok: false, code: "bad_status", http: 400 };
  if (isLocked(session, now)) return { ok: false, code: "locked", http: 409 };
  if (record.status === "review") return { ok: true, kind: record.query?.raisedAt ? "query" : "review" };
  if (["joined", "heard"].includes(record.status)) return { ok: false, code: "in_progress", http: 409 };
  if (record.status === status) return { ok: false, code: "same_status", http: 409 };
  if (!String(note || "").trim()) return { ok: false, code: "note_required", http: 400 };
  return { ok: true, kind: "override" };
};

// What an undecided review case becomes at the lock.
const lockOutcome = (record) => ({
  status: "absent",
  reasons: [...new Set([...(record.reasons || []), "unresolved"])],
});

const cleanQuery = ({ reason, text } = {}) => {
  if (!QUERY_REASONS.includes(reason)) return { error: "Choose a reason" };
  const trimmed = String(text || "").trim();
  if (trimmed.length > QUERY_TEXT_MAX) return { error: `Keep it under ${QUERY_TEXT_MAX} characters` };
  if (reason === "other" && !trimmed) return { error: "Tell your teacher what happened" };
  return { reason, text: trimmed };
};

module.exports = { QUERY_REASONS, QUERY_TEXT_MAX, isLocked, canQuery, canDecide, lockOutcome, cleanQuery, teacherDecided };
