const mongoose = require("mongoose");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const FaceSession = require("../models/faceSessionModels");
const faceClient = require("../utils/faceClient");

const FACE_SESSION_TTL_MS = 5 * 60 * 1000;
// Phase 7 exposes only the self-test; enrollment (8) and check-in (9) add their own purposes.
const PURPOSES_NOW = ["test"];

const requireConfigured = (next) => {
  if (faceClient.isConfigured()) return true;
  next(new ErrorHandler("Face checks are not configured on the server", 503));
  return false;
};

exports.startLivenessSession = catchAsyncError(async (req, res, next) => {
  if (!requireConfigured(next)) return;
  const purpose = req.body?.purpose;
  if (!PURPOSES_NOW.includes(purpose)) return next(new ErrorHandler(`Purpose must be one of: ${PURPOSES_NOW.join(", ")}`, 400));

  const id = new mongoose.Types.ObjectId();
  const { sessionId } = await faceClient.createLivenessSession(id.toString());
  await FaceSession.create({
    _id: id,
    user: req.user._id,
    purpose,
    awsSessionId: sessionId,
    expiresAt: new Date(Date.now() + FACE_SESSION_TTL_MS),
  });
  res.status(201).json({ success: true, livenessSessionId: sessionId, region: process.env.AWS_REGION });
});

// Reads one finished liveness session once; optionally compares its live frame
// with the user's previous test (same person → high, different → low).
exports.getTestResult = catchAsyncError(async (req, res, next) => {
  if (!requireConfigured(next)) return;
  const { livenessSessionId, compareWith } = req.body || {};
  if (!livenessSessionId) return next(new ErrorHandler("livenessSessionId is required", 400));

  const faceSession = await FaceSession.findOneAndUpdate(
    { awsSessionId: String(livenessSessionId), user: req.user._id, purpose: "test", usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  );
  if (!faceSession) return next(new ErrorHandler("Face check expired or already used, please start again", 404));

  const result = await faceClient.getLivenessResult(faceSession.awsSessionId);
  faceSession.result = { status: result.status, confidence: result.confidence, verdict: result.verdict };
  if (result.referenceImage) faceSession.referenceImage = result.referenceImage;
  await faceSession.save();

  let comparison = null;
  if (compareWith && result.referenceImage) {
    const previous = await FaceSession.findOne({ awsSessionId: String(compareWith), user: req.user._id, purpose: "test", referenceImage: { $exists: true } });
    if (previous?.referenceImage) {
      comparison = await faceClient.compareFaces(previous.referenceImage, result.referenceImage);
    }
  }

  res.status(200).json({
    success: true,
    status: result.status,
    confidence: result.confidence,
    verdict: result.verdict,
    thresholds: faceClient.thresholds(),
    // The user's own frame, shown back on the test page only.
    referenceImage: result.referenceImage ? `data:image/jpeg;base64,${result.referenceImage.toString("base64")}` : null,
    comparison,
  });
});
