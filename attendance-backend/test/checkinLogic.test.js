const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { decide } = require("../utils/attendanceDecision");
const { endOfDay } = require("../utils/clock");
const { KEY_SPACE, mintKey, isKeyAcceptable } = require("../utils/keys");
const { normaliseRosterEntry } = require("../utils/roster");

const originalTestStudents = process.env.TEST_STUDENT_EMAILS;
after(() => {
  if (originalTestStudents === undefined) delete process.env.TEST_STUDENT_EMAILS;
  else process.env.TEST_STUDENT_EMAILS = originalTestStudents;
});

test("decision: heard + bound device → present; joined only → review not_heard; never joined → absent", () => {
  assert.deepEqual(decide({ joined: true, heard: true, deviceVerified: true }), { status: "present", reasons: [] });
  assert.deepEqual(decide({ joined: true, heard: false }), { status: "review", reasons: ["not_heard"] });
  assert.deepEqual(decide({ joined: false }), { status: "absent", reasons: ["not_joined"] });
  assert.deepEqual(decide(), { status: "absent", reasons: ["not_joined"] });
  // A heard key without a verified device is never "present".
  assert.equal(decide({ joined: true, heard: true, deviceVerified: false }).status, "review");
});

test("keys: minted keys fit the 7-digit base-15 codec", () => {
  assert.equal(KEY_SPACE, 170859375);
  for (let index = 0; index < 1000; index += 1) {
    const key = mintKey();
    assert.ok(Number.isInteger(key) && key >= 0 && key < KEY_SPACE);
  }
});

test("keys: accepted from start of play until one lifetime after expiry", () => {
  const key = { validFrom: new Date("2026-10-22T10:00:00Z"), validUntil: new Date("2026-10-22T10:00:15Z") };
  const at = (iso) => new Date(iso);
  const grace = 15000;
  assert.equal(isKeyAcceptable(key, at("2026-10-22T09:59:59Z"), grace), false, "not before it was issued");
  assert.equal(isKeyAcceptable(key, at("2026-10-22T10:00:05Z"), grace), true);
  assert.equal(isKeyAcceptable(key, at("2026-10-22T10:00:20Z"), grace), true, "grace after rotation");
  assert.equal(isKeyAcceptable(key, at("2026-10-22T10:00:31Z"), grace), false, "stale after grace");
  assert.equal(isKeyAcceptable(key, at("2026-10-22T10:00:20Z"), 0), false);
  assert.equal(isKeyAcceptable(null), false);
});

test("clock: end of the Indian day, whatever the UTC date", () => {
  // 22 Oct 2026 23:00 IST = 17:30 UTC → day ends 22 Oct 23:59:59.999 IST = 18:29:59.999 UTC.
  assert.equal(endOfDay(new Date("2026-10-22T17:30:00Z"), "Asia/Kolkata").toISOString(), "2026-10-22T18:29:59.999Z");
  // 23 Oct 2026 00:30 IST = 22 Oct 19:00 UTC → belongs to 23 Oct.
  assert.equal(endOfDay(new Date("2026-10-22T19:00:00Z"), "Asia/Kolkata").toISOString(), "2026-10-23T18:29:59.999Z");
  assert.equal(endOfDay(new Date("2026-10-22T12:00:00Z"), "UTC").toISOString(), "2026-10-22T23:59:59.999Z");
});

test("roster: test-student Gmails are accepted only while listed in TEST_STUDENT_EMAILS", () => {
  process.env.TEST_STUDENT_EMAILS = "";
  assert.ok(normaliseRosterEntry("tester@gmail.com").error);
  process.env.TEST_STUDENT_EMAILS = "tester@gmail.com";
  const { entry, error } = normaliseRosterEntry(" Tester@Gmail.com ");
  assert.equal(error, undefined);
  assert.equal(entry.email, "tester@gmail.com");
  assert.ok(normaliseRosterEntry("someone.else@gmail.com").error);
});

const { relayPlan, studentWave, SLOT_MS } = require("../utils/relay");

test("relay: hearing the teacher makes a wave-1 student who relays wave 1", () => {
  assert.equal(studentWave(0), 1);
  const plan = relayPlan({ keyWave: 0, maxWaves: 5, now: 1_000_000_300 });
  assert.equal(plan.wave, 1);
  assert.equal(plan.playAt.length, 3);
  // Shared slot boundaries, at least the lead time ahead, one slot apart.
  plan.playAt.forEach((time) => assert.equal(time % SLOT_MS, 0));
  assert.ok(plan.playAt[0] >= 1_000_000_300 + 1500);
  assert.equal(plan.playAt[1] - plan.playAt[0], SLOT_MS);
});

test("relay: phones in the same wave get the same slots; the cascade stops at maxWaves", () => {
  const first = relayPlan({ keyWave: 1, maxWaves: 5, now: 1_000_000_100 });
  const second = relayPlan({ keyWave: 1, maxWaves: 5, now: 1_000_000_400 });
  assert.deepEqual(first.playAt, second.playAt);
  assert.equal(relayPlan({ keyWave: 3, maxWaves: 5 }).wave, 4);
  assert.equal(relayPlan({ keyWave: 4, maxWaves: 5 }), null, "wave 5 students do not relay");
  assert.equal(relayPlan({ keyWave: 0, maxWaves: 1 }), null);
});
