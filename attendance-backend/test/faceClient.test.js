const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const faceClient = require("../utils/faceClient");

const saved = { ...process.env };
after(() => {
  faceClient.setClientForTests(null);
  for (const name of ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "LIVENESS_THRESHOLD", "MATCH_THRESHOLD", "REVIEW_THRESHOLD"]) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

// Fake Rekognition: answers by command name.
const fakeClient = (handlers) => ({
  sent: [],
  async send(command) {
    this.sent.push(command);
    const handler = handlers[command.constructor.name];
    if (!handler) throw new Error(`unexpected ${command.constructor.name}`);
    return handler(command.input);
  },
});

test("configured only when region and both keys are present", () => {
  process.env.AWS_REGION = "ap-south-1";
  process.env.AWS_ACCESS_KEY_ID = "id";
  delete process.env.AWS_SECRET_ACCESS_KEY;
  assert.equal(faceClient.isConfigured(), false);
  process.env.AWS_SECRET_ACCESS_KEY = "secret";
  assert.equal(faceClient.isConfigured(), true);
});

test("thresholds default to 80 / 90 / 75 and follow config", () => {
  delete process.env.LIVENESS_THRESHOLD;
  delete process.env.MATCH_THRESHOLD;
  delete process.env.REVIEW_THRESHOLD;
  assert.deepEqual(faceClient.thresholds(), { liveness: 80, match: 90, review: 75 });
  process.env.MATCH_THRESHOLD = "95";
  assert.equal(faceClient.thresholds().match, 95);
  delete process.env.MATCH_THRESHOLD;
});

test("liveness and match decisions", () => {
  const limits = { liveness: 80, match: 90, review: 75 };
  assert.equal(faceClient.classifyLiveness("SUCCEEDED", 97, limits), "live");
  assert.equal(faceClient.classifyLiveness("SUCCEEDED", 40, limits), "not_live");
  assert.equal(faceClient.classifyLiveness("EXPIRED", 99, limits), "failed");
  assert.equal(faceClient.classifyLiveness("IN_PROGRESS", 0, limits), "failed");
  assert.equal(faceClient.classifyMatch(99.2, limits), "match");
  assert.equal(faceClient.classifyMatch(82, limits), "unsure");
  assert.equal(faceClient.classifyMatch(10, limits), "no_match");
});

test("liveness session create + result mapping, with the reference frame as a Buffer", async () => {
  const fake = fakeClient({
    CreateFaceLivenessSessionCommand: (input) => {
      assert.equal(input.ClientRequestToken, "token-1");
      return { SessionId: "aws-session-1" };
    },
    GetFaceLivenessSessionResultsCommand: (input) => {
      assert.equal(input.SessionId, "aws-session-1");
      return { Status: "SUCCEEDED", Confidence: 96.5, ReferenceImage: { Bytes: new Uint8Array([255, 216, 1, 2]) } };
    },
  });
  faceClient.setClientForTests(fake);
  assert.deepEqual(await faceClient.createLivenessSession("token-1"), { sessionId: "aws-session-1" });
  const result = await faceClient.getLivenessResult("aws-session-1");
  assert.equal(result.verdict, "live");
  assert.equal(result.confidence, 96.5);
  assert.ok(Buffer.isBuffer(result.referenceImage));
  assert.equal(result.referenceImage.length, 4);
});

test("failed liveness has no reference frame and verdict failed", async () => {
  faceClient.setClientForTests(fakeClient({ GetFaceLivenessSessionResultsCommand: () => ({ Status: "FAILED" }) }));
  const result = await faceClient.getLivenessResult("x");
  assert.deepEqual({ verdict: result.verdict, confidence: result.confidence, image: result.referenceImage }, { verdict: "failed", confidence: 0, image: null });
});

test("compareFaces takes the best match; no face → 0 instead of an error", async () => {
  faceClient.setClientForTests(fakeClient({
    CompareFacesCommand: () => ({ FaceMatches: [{ Similarity: 71 }, { Similarity: 99.4 }] }),
  }));
  assert.deepEqual(await faceClient.compareFaces(Buffer.from("a"), Buffer.from("b")), { similarity: 99.4, decision: "match", faceFound: true });

  faceClient.setClientForTests(fakeClient({ CompareFacesCommand: () => ({ FaceMatches: [] }) }));
  assert.equal((await faceClient.compareFaces(Buffer.from("a"), Buffer.from("b"))).decision, "no_match");

  faceClient.setClientForTests(fakeClient({
    CompareFacesCommand: () => {
      const error = new Error("no face");
      error.name = "InvalidParameterException";
      throw error;
    },
  }));
  assert.deepEqual(await faceClient.compareFaces(Buffer.from("a"), Buffer.from("b")), { similarity: 0, decision: "no_match", faceFound: false });
});

test("an unusable image is reported as no face, not as an error", async () => {
  faceClient.setClientForTests(fakeClient({
    CompareFacesCommand: () => {
      const error = new Error("Request has invalid image format");
      error.name = "InvalidImageFormatException";
      throw error;
    },
  }));
  assert.equal((await faceClient.compareFaces(Buffer.from("a"), Buffer.from("b"))).faceFound, false);
});
