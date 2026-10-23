const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_ATTEMPTS, loginIdFromEmail, textContainsRoll, enrollmentDecision, parseImageDataUrl } = require("../utils/enrollment");

test("login id comes from the college email", () => {
  assert.equal(loginIdFromEmail("2023ugcs111@nitjsr.ac.in"), "2023UGCS111");
  assert.equal(MAX_ATTEMPTS, 3);
});

test("roll number found on the ID card regardless of spacing, case and punctuation", () => {
  assert.equal(textContainsRoll(["NIT JAMSHEDPUR", "Roll No: 2023 UGCS 111"], "2023UGCS111"), true);
  assert.equal(textContainsRoll(["roll no.2023ugcs-111"], "2023UGCS111"), true);
  assert.equal(textContainsRoll(["2023UGCS112"], "2023UGCS111"), false);
  assert.equal(textContainsRoll([], "2023UGCS111"), false);
  assert.equal(textContainsRoll(["anything"], ""), false);
});

test("decision table", () => {
  const live = { livenessVerdict: "live" };
  assert.deepEqual(enrollmentDecision({ ...live, matchDecision: "match", rollMatch: true }), { outcome: "verified", reasons: [] });
  assert.deepEqual(enrollmentDecision({ ...live, matchDecision: "match", rollMatch: null, testAccount: true }), { outcome: "verified", reasons: [] });
  assert.deepEqual(enrollmentDecision({ ...live, matchDecision: "match", rollMatch: false }), { outcome: "pending", reasons: ["roll_mismatch"] });
  assert.deepEqual(enrollmentDecision({ ...live, matchDecision: "unsure", rollMatch: true }), { outcome: "pending", reasons: ["face_unsure"] });
  assert.deepEqual(enrollmentDecision({ ...live, matchDecision: "no_match", rollMatch: false }), { outcome: "pending", reasons: ["face_mismatch", "roll_mismatch"] });
  assert.deepEqual(enrollmentDecision({ livenessVerdict: "not_live", matchDecision: "match", rollMatch: true }), { outcome: "failed", reasons: ["not_live"] });
  assert.deepEqual(enrollmentDecision({ livenessVerdict: "failed", matchDecision: "match", rollMatch: true }), { outcome: "failed", reasons: ["liveness_incomplete"] });
});

test("image data URLs: JPEG/PNG only, size-capped", () => {
  const small = `data:image/jpeg;base64,${Buffer.from("abc").toString("base64")}`;
  assert.equal(parseImageDataUrl(small).contentType, "image/jpeg");
  assert.equal(parseImageDataUrl(small).buffer.toString(), "abc");
  assert.ok(parseImageDataUrl("data:image/gif;base64,AAAA").error);
  assert.ok(parseImageDataUrl("not a data url").error);
  assert.ok(parseImageDataUrl(`data:image/png;base64,${Buffer.alloc(800 * 1024).toString("base64")}`).error);
});
