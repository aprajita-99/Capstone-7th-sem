const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { canonicalJson, buildProofMessage, verifySignature } = require("../utils/deviceProof");

const { subtle } = crypto.webcrypto;

// Same key type and signature format the browser produces (raw r||s).
const makeDeviceKey = async () => {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { privateKey: pair.privateKey, jwk: await subtle.exportKey("jwk", pair.publicKey) };
};

const sign = async (privateKey, message) =>
  Buffer.from(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, Buffer.from(message, "utf8"))).toString("base64url");

test("canonical JSON ignores key order at every level and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } }), '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
  assert.equal(buildProofMessage("claim", "n", { key: 5, sessionId: "s" }), buildProofMessage("claim", "n", { sessionId: "s", key: 5 }));
});

test("a browser-format signature over the proof message is accepted", async () => {
  const { privateKey, jwk } = await makeDeviceKey();
  const message = buildProofMessage("claim", "nonce-1", { sessionId: "abc", key: 123 });
  assert.equal(verifySignature(jwk, message, await sign(privateKey, message)), true);
});

test("changed payload, purpose or nonce invalidates the signature", async () => {
  const { privateKey, jwk } = await makeDeviceKey();
  const signature = await sign(privateKey, buildProofMessage("claim", "nonce-1", { key: 123 }));
  assert.equal(verifySignature(jwk, buildProofMessage("claim", "nonce-1", { key: 124 }), signature), false);
  assert.equal(verifySignature(jwk, buildProofMessage("bind", "nonce-1", { key: 123 }), signature), false);
  assert.equal(verifySignature(jwk, buildProofMessage("claim", "nonce-2", { key: 123 }), signature), false);
});

test("another device's key cannot pass as this one", async () => {
  const device = await makeDeviceKey();
  const other = await makeDeviceKey();
  const message = buildProofMessage("bind", "n", {});
  assert.equal(verifySignature(device.jwk, message, await sign(other.privateKey, message)), false);
});

test("DER-encoded, garbage and non-P-256 inputs are rejected without throwing", async () => {
  const { privateKey, jwk } = await makeDeviceKey();
  const message = buildProofMessage("bind", "n", {});
  const nodeKey = crypto.createPrivateKey({ key: await subtle.exportKey("jwk", privateKey), format: "jwk" });
  const der = crypto.sign("sha256", Buffer.from(message), nodeKey).toString("base64url"); // DER by default
  assert.equal(verifySignature(jwk, message, der), false);
  assert.equal(verifySignature(jwk, message, "not base64url!"), false);
  assert.equal(verifySignature(jwk, message, ""), false);
  assert.equal(verifySignature({ ...jwk, crv: "P-384" }, message, await sign(privateKey, message)), false);
  assert.equal(verifySignature({ kty: "EC", crv: "P-256", x: "bad", y: "bad" }, message, await sign(privateKey, message)), false);
  assert.equal(verifySignature(null, message, await sign(privateKey, message)), false);
});
