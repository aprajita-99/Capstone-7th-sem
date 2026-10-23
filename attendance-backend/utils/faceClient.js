/**
 * Face service = Amazon Rekognition (FEATURES.md Phase 7).
 * - Face Liveness: the backend creates a session, the browser streams a short
 *   selfie video straight to AWS, the backend reads the result (confidence +
 *   a reference frame).
 * - CompareFaces: similarity between two face images.
 * Only the backend calls these APIs; the browser only starts the stream with
 * Cognito guest credentials. Thresholds come from config.
 */
const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand,
  DetectFacesCommand,
  DetectTextCommand,
} = require("@aws-sdk/client-rekognition");

const UNUSABLE_IMAGE_ERRORS = ["InvalidParameterException", "InvalidImageFormatException", "ImageTooLargeException"];

let client = null;

const isConfigured = () => Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

const getClient = () => {
  if (!client) client = new RekognitionClient({ region: process.env.AWS_REGION, maxAttempts: 2 });
  return client;
};

// Tests swap in a fake { send(command) } client.
const setClientForTests = (fakeClient) => {
  client = fakeClient;
};

const envNumber = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const thresholds = () => ({
  liveness: envNumber("LIVENESS_THRESHOLD", 80),
  match: envNumber("MATCH_THRESHOLD", 90),
  review: envNumber("REVIEW_THRESHOLD", 75),
});

// Pure decisions, unit-tested.
const classifyLiveness = (status, confidence, limits = thresholds()) => {
  if (status !== "SUCCEEDED") return "failed";
  return confidence >= limits.liveness ? "live" : "not_live";
};

const classifyMatch = (similarity, limits = thresholds()) => {
  if (similarity >= limits.match) return "match";
  if (similarity >= limits.review) return "unsure";
  return "no_match";
};

const createLivenessSession = async (clientRequestToken) => {
  const output = await getClient().send(
    new CreateFaceLivenessSessionCommand({ ClientRequestToken: clientRequestToken, Settings: { AuditImagesLimit: 0 } })
  );
  return { sessionId: output.SessionId };
};

// → { status, confidence, verdict, referenceImage (Buffer|null) }
const getLivenessResult = async (sessionId) => {
  const output = await getClient().send(new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }));
  const confidence = typeof output.Confidence === "number" ? output.Confidence : 0;
  const bytes = output.ReferenceImage?.Bytes;
  return {
    status: output.Status,
    confidence,
    verdict: classifyLiveness(output.Status, confidence),
    referenceImage: bytes ? Buffer.from(bytes) : null,
  };
};

// → { similarity, decision, faceFound }. No face in either image → similarity 0.
const compareFaces = async (sourceImage, targetImage) => {
  try {
    const output = await getClient().send(
      new CompareFacesCommand({ SourceImage: { Bytes: sourceImage }, TargetImage: { Bytes: targetImage }, SimilarityThreshold: 0 })
    );
    const similarity = Math.max(0, ...(output.FaceMatches || []).map((match) => match.Similarity || 0));
    return { similarity, decision: classifyMatch(similarity), faceFound: true };
  } catch (error) {
    // No detectable face, or not a usable image: treat as "no match" (the caller sends it to review).
    if (UNUSABLE_IMAGE_ERRORS.includes(error.name)) {
      return { similarity: 0, decision: "no_match", faceFound: false };
    }
    throw error;
  }
};

// Number of faces in an image (0 for an unusable image).
const detectFaces = async (image) => {
  try {
    const output = await getClient().send(new DetectFacesCommand({ Image: { Bytes: image } }));
    return (output.FaceDetails || []).length;
  } catch (error) {
    if (UNUSABLE_IMAGE_ERRORS.includes(error.name)) return 0;
    throw error;
  }
};

// Text lines found in an image (empty for an unusable image).
const detectText = async (image) => {
  try {
    const output = await getClient().send(new DetectTextCommand({ Image: { Bytes: image } }));
    return (output.TextDetections || []).filter((item) => item.Type === "LINE").map((item) => item.DetectedText);
  } catch (error) {
    if (UNUSABLE_IMAGE_ERRORS.includes(error.name)) return [];
    throw error;
  }
};

module.exports = {
  isConfigured,
  detectFaces,
  detectText,
  thresholds,
  classifyLiveness,
  classifyMatch,
  createLivenessSession,
  getLivenessResult,
  compareFaces,
  setClientForTests,
};
