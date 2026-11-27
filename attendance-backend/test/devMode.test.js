const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { isDevMode } = require("../utils/devMode");
const { enrollmentDecision, enrollmentView } = require("../utils/enrollment");
const { buildProofMessage, verifyDeviceProof } = require("../utils/deviceProof");
const DeviceChallenge = require("../models/deviceChallengeModels");

const { subtle } = crypto.webcrypto;
const originalDevMode = process.env.DEV_MODE;
const originalFindOneAndUpdate = DeviceChallenge.findOneAndUpdate;

afterEach(() => {
  if (originalDevMode === undefined) delete process.env.DEV_MODE;
  else process.env.DEV_MODE = originalDevMode;
  DeviceChallenge.findOneAndUpdate = originalFindOneAndUpdate;
});

const makeDeviceKey = async () => {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { privateKey: pair.privateKey, jwk: await subtle.exportKey("jwk", pair.publicKey) };
};
const sign = async (privateKey, message) =>
  Buffer.from(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, Buffer.from(message, "utf8"))).toString("base64url");

// Every challenge lookup succeeds with this nonce (no database needed).
const stubChallenge = (nonce) => {
  DeviceChallenge.findOneAndUpdate = async () => ({ nonce });
};

test("DEV_MODE accepts common on values and is off by default", () => {
  delete process.env.DEV_MODE;
  assert.equal(isDevMode(), false);
  for (const value of ["true", "TRUE", "1", "yes", " on "]) {
    process.env.DEV_MODE = value;
    assert.equal(isDevMode(), true, value);
  }
  for (const value of ["false", "0", "", "no"]) {
    process.env.DEV_MODE = value;
    assert.equal(isDevMode(), false, value);
  }
});

test("dev mode verifies a live selfie without an ID card, but never a non-live one", () => {
  assert.deepEqual(enrollmentDecision({ livenessVerdict: "live", matchDecision: "skipped", rollMatch: null, devMode: true }), { outcome: "verified", reasons: [] });
  assert.equal(enrollmentDecision({ livenessVerdict: "not_live", matchDecision: "skipped", rollMatch: null, devMode: true }).outcome, "failed");
  // Without dev mode the same inputs still need a teacher.
  assert.equal(enrollmentDecision({ livenessVerdict: "live", matchDecision: "no_match", rollMatch: null }).outcome, "pending");
});

test("the enrollment status tells the website whether the ID card step is needed", () => {
  delete process.env.DEV_MODE;
  assert.equal(enrollmentView({}).idCardRequired, true);
  process.env.DEV_MODE = "true";
  assert.equal(enrollmentView({}).idCardRequired, false);
  assert.equal(enrollmentView({}).devMode, true);
});

test("a second browser's signature counts only while dev mode is on", async () => {
  const bound = await makeDeviceKey();
  const second = await makeDeviceKey();
  const user = {
    _id: "u1",
    deviceBinding: { publicKeyJwk: bound.jwk, devKeys: [{ fingerprint: "f2", publicKeyJwk: second.jwk }] },
  };
  stubChallenge("nonce-1");
  const payload = { sessionId: "s", key: 7 };
  const signature = await sign(second.privateKey, buildProofMessage("claim", "nonce-1", payload));
  const attempt = () => verifyDeviceProof({ user, challengeId: "c1", signature, purpose: "claim", payload });

  delete process.env.DEV_MODE;
  assert.equal((await attempt()).ok, false);
  process.env.DEV_MODE = "true";
  assert.equal((await attempt()).ok, true);

  // The bound phone keeps working either way.
  const boundSignature = await sign(bound.privateKey, buildProofMessage("claim", "nonce-1", payload));
  delete process.env.DEV_MODE;
  assert.equal((await verifyDeviceProof({ user, challengeId: "c1", signature: boundSignature, purpose: "claim", payload })).ok, true);
});

test("an unknown browser is still refused in dev mode", async () => {
  const bound = await makeDeviceKey();
  const stranger = await makeDeviceKey();
  stubChallenge("n");
  process.env.DEV_MODE = "true";
  const signature = await sign(stranger.privateKey, buildProofMessage("face", "n", {}));
  const result = await verifyDeviceProof({ user: { _id: "u1", deviceBinding: { publicKeyJwk: bound.jwk } }, challengeId: "c", signature, purpose: "face" });
  assert.equal(result.ok, false);
});
