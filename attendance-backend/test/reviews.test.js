const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isLocked, canQuery, canDecide, lockOutcome, cleanQuery } = require("../utils/reviewRules");
const { lockTimeFor, localDay } = require("../utils/clock");
const mailer = require("../utils/mailer");
const { secretMatches } = require("../controllers/jobsController");

const NOW = new Date("2026-10-24T10:00:00Z");
const openSession = { status: "closed", lockAt: new Date("2026-10-25T03:30:00Z") };
const lockedSession = { status: "closed", lockAt: new Date("2026-10-24T09:00:00Z") };

test("clock: check-ins lock at 09:00 IST the next morning", () => {
  // 24 Oct 15:00 IST → 25 Oct 09:00 IST (03:30 UTC).
  assert.equal(lockTimeFor(new Date("2026-10-24T09:30:00Z"), "Asia/Kolkata", 9).toISOString(), "2026-10-25T03:30:00.000Z");
  // 24 Oct 23:30 IST → still 25 Oct 09:00 IST.
  assert.equal(lockTimeFor(new Date("2026-10-24T18:00:00Z"), "Asia/Kolkata", 9).toISOString(), "2026-10-25T03:30:00.000Z");
  // 25 Oct 00:30 IST belongs to 25 Oct → 26 Oct 09:00 IST.
  assert.equal(lockTimeFor(new Date("2026-10-24T19:00:00Z"), "Asia/Kolkata", 9).toISOString(), "2026-10-26T03:30:00.000Z");
  assert.equal(localDay(new Date("2026-10-24T19:00:00Z"), "Asia/Kolkata"), "2026-10-25");
});

test("lock: locked by status or once lockAt has passed", () => {
  assert.equal(isLocked({ status: "locked", lockAt: new Date("2030-01-01") }, NOW), true);
  assert.equal(isLocked(lockedSession, NOW), true);
  assert.equal(isLocked(openSession, NOW), false);
  assert.deepEqual(lockOutcome({ reasons: ["face_unsure"] }), { status: "absent", reasons: ["face_unsure", "unresolved"] });
  assert.deepEqual(lockOutcome({ reasons: ["unresolved"] }).reasons, ["unresolved"]);
});

test("query: absent or review, once, before the lock, not after the teacher decided", () => {
  assert.equal(canQuery({ status: "absent", reasons: [] }, openSession, NOW).ok, true);
  assert.equal(canQuery({ status: "review", reasons: [] }, openSession, NOW).ok, true);
  assert.equal(canQuery({ status: "present" }, openSession, NOW).code, "not_queryable");
  assert.equal(canQuery({ status: "heard" }, openSession, NOW).code, "not_queryable");
  assert.equal(canQuery({ status: "absent", query: { raisedAt: NOW } }, openSession, NOW).code, "already_queried");
  assert.equal(canQuery({ status: "absent" }, lockedSession, NOW).code, "locked");
  assert.equal(canQuery({ status: "absent", decision: { status: "absent", kind: "review" } }, openSession, NOW).code, "teacher_decided");
  // Phase 9 decisions have no kind but carry the teacher.
  assert.equal(canQuery({ status: "absent", decision: { status: "absent", by: "teacher" } }, openSession, NOW).code, "teacher_decided");
});

test("query text: reason required, 300 characters, text required for 'other'", () => {
  assert.deepEqual(cleanQuery({ reason: "cant_hear", text: "  phone mic broken " }), { reason: "cant_hear", text: "phone mic broken" });
  assert.ok(cleanQuery({ reason: "bogus" }).error);
  assert.ok(cleanQuery({ reason: "other", text: " " }).error);
  assert.ok(cleanQuery({ reason: "was_present", text: "x".repeat(301) }).error);
});

test("decisions: review any way; overrides present ↔ absent need a note; nothing after the lock", () => {
  assert.deepEqual(canDecide({ status: "review" }, openSession, "present", "", NOW), { ok: true, kind: "review" });
  assert.deepEqual(canDecide({ status: "review", query: { raisedAt: NOW } }, openSession, "absent", "", NOW), { ok: true, kind: "query" });
  assert.equal(canDecide({ status: "present" }, openSession, "absent", "", NOW).code, "note_required");
  assert.deepEqual(canDecide({ status: "present" }, openSession, "absent", "not in the room", NOW), { ok: true, kind: "override" });
  assert.equal(canDecide({ status: "absent" }, openSession, "absent", "x", NOW).code, "same_status");
  assert.equal(canDecide({ status: "heard" }, openSession, "present", "x", NOW).code, "in_progress");
  assert.equal(canDecide({ status: "review" }, openSession, "maybe", "", NOW).code, "bad_status");
  assert.equal(canDecide({ status: "review" }, lockedSession, "present", "", NOW).code, "locked");
});

test("digest email: counts, link to the attendance tab, HTML escaped", () => {
  const message = mailer.buildDigest({
    teacherName: "Dr <b>Rao</b>",
    appUrl: "https://example.app/",
    formatTime: () => "Sat 09:00",
    groups: [
      { courseCode: "CS<301>", section: "A", startedAt: NOW, lockAt: NOW, reviews: 3, queries: 1 },
      { courseCode: "CS302", startedAt: NOW, lockAt: NOW, reviews: 1, queries: 0 },
    ],
  });
  assert.match(message.subject, /4 attendance reviews waiting \(1 from student queries\)/);
  assert.match(message.text, /https:\/\/example\.app\/teacher\/reviews\?tab=attendance/);
  assert.match(message.text, /CS<301> · A/);
  assert.ok(!message.html.includes("<b>Rao</b>") && message.html.includes("&lt;b&gt;Rao&lt;/b&gt;"));
  assert.ok(message.html.includes("CS&lt;301&gt;"));
});

test("mailer: skipped when not configured", async () => {
  const saved = { key: process.env.BREVO_API_KEY, from: process.env.MAIL_FROM };
  delete process.env.BREVO_API_KEY;
  delete process.env.MAIL_FROM;
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(mailer.isConfigured(), false);
    assert.deepEqual(await mailer.send({ to: { email: "t@example.com" }, subject: "s", text: "t", html: "h" }), { skipped: true });
  } finally {
    console.log = log;
    if (saved.key !== undefined) process.env.BREVO_API_KEY = saved.key;
    if (saved.from !== undefined) process.env.MAIL_FROM = saved.from;
  }
});

test("jobs secret: exact match only", () => {
  assert.equal(secretMatches("s3cret-value", "s3cret-value"), true);
  assert.equal(secretMatches("s3cret-valuE", "s3cret-value"), false);
  assert.equal(secretMatches(undefined, "s3cret-value"), false);
  assert.equal(secretMatches("anything", ""), false);
});
