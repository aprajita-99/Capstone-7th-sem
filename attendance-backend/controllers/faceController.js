const mongoose = require("mongoose");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const FaceSession = require("../models/faceSessionModels");
const faceClient = require("../utils/faceClient");

const DeviceBindingRequest = require("../models/deviceBindingRequestModels");
const { MAX_ATTEMPTS } = require("../utils/enrollment");
const { isDevMode } = require("../utils/devMode");
const { checkinFaceState } = require("./sessionController");

const FACE_SESSION_TTL_MS = 5 * 60 * 1000;
// test: anyone signed in (Phase 7). enroll / rebind: students (Phase 8). checkin: students (Phase 9).
const PURPOSES_NOW = ["test", "enroll", "rebind", "checkin"];
const STUDENT_PURPOSES = ["enroll", "rebind", "checkin"];

const requireConfigured = (next) => {
  if (faceClient.isConfigured()) return true;
  next(new ErrorHandler("Face checks are not configured on the server", 503));
  return false;
};

exports.startLivenessSession = catchAsyncError(async (req, res, next) => {
  if (!requireConfigured(next)) return;
  const purpose = req.body?.purpose;
  if (!PURPOSES_NOW.includes(purpose)) return next(new ErrorHandler(`Purpose must be one of: ${PURPOSES_NOW.join(", ")}`, 400));
  if (STUDENT_PURPOSES.includes(purpose) && req.user.role !== "student") return next(new ErrorHandler("Only students enroll a face", 403));

  let deviceRequest;
  if (purpose === "enroll") {
    const enrollment = req.user.enrollment || {};
    if (!req.user.consent?.acceptedAt) return next(new ErrorHandler("Accept the consent notice first", 400));
    if (!["none", "rejected", undefined].includes(enrollment.status)) return next(new ErrorHandler("Your identity check is already submitted", 409));
    if ((enrollment.attempts || 0) >= MAX_ATTEMPTS) return next(new ErrorHandler("No attempts left. Ask your teacher to reset your identity check.", 403));
    // Dev mode has no ID card step (the live selfie alone verifies).
    if (!isDevMode() && !enrollment.idCardMedia) return next(new ErrorHandler("Upload your college ID card first", 400));
  }
  if (purpose === "rebind") {
    if (req.user.enrollment?.status !== "verified") return next(new ErrorHandler("Your identity is not verified yet; your teacher will approve this phone", 409));
    deviceRequest = await DeviceBindingRequest.findOne({ _id: mongoose.isValidObjectId(req.body.requestId) ? req.body.requestId : null, student: req.user._id, status: "pending" });
    if (!deviceRequest) return next(new ErrorHandler("No pending phone change to verify", 404));
  }

  let checkinSession;
  if (purpose === "checkin") {
    const state = await checkinFaceState(req.user, req.body.sessionId);
    if (state.error) return next(state.error);
    checkinSession = state.session;
  }

  const id = new mongoose.Types.ObjectId();
  const { sessionId } = await faceClient.createLivenessSession(id.toString());
  await FaceSession.create({
    _id: id,
    user: req.user._id,
    purpose,
    deviceRequest: deviceRequest?._id,
    session: checkinSession?._id,
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
