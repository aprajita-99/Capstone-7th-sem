const { OAuth2Client } = require("google-auth-library");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const sendToken = require("../utils/jwttoken");
const User = require("../models/userModels");
const Enrollment = require("../models/enrollmentModels");
const DeviceBindingRequest = require("../models/deviceBindingRequestModels");
const { fingerprintPublicKey } = require("../utils/deviceBinding");
const { PURPOSES, issueChallenge, verifyDeviceProof } = require("../utils/deviceProof");
const { reviewableStudentEmails, teacherCanReviewStudent } = require("../utils/teacherAccess");
const AuditLog = require("../models/auditLogModels");
const { enrollmentView } = require("../utils/enrollment");
const { isDevMode, MAX_DEV_DEVICES } = require("../utils/devMode");
const {
  normaliseEmail,
  isProvisionedTeacher,
  isTestStudent,
  isAllowedSignInEmail,
} = require("../utils/signInPolicy");

// One client for the whole process: it caches Google's signing certificates,
// so sign-ins after the first do not wait for an extra fetch to Google.
let googleClient = null;
const getGoogleClient = () => {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  if (!googleClient) googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return googleClient;
};

const hasRosterAccess = async (email) => Enrollment.exists({ email, status: "active" });

exports.googleSignIn = catchAsyncError(async (req, res, next) => {
  const { credential } = req.body;
  const googleClient = getGoogleClient();

  if (!googleClient) {
    return next(new ErrorHandler("Google sign-in is not configured on the server", 503));
  }
  if (!credential) {
    return next(new ErrorHandler("Google ID token is required", 400));
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    return next(new ErrorHandler("Google sign-in token could not be verified", 401));
  }

  const email = normaliseEmail(payload?.email);
  if (!payload || !payload.email_verified || !isAllowedSignInEmail(email)) {
    return next(new ErrorHandler("Sign in with a Google account that has a verified email", 403));
  }
  const testAccount = isTestStudent(email);

  // Test students (TEST_STUDENT_EMAILS) skip the roster gate: they exist to
  // exercise the app before the pilot and are never on a college roster.
  const [existingUser, onRoster] = await Promise.all([User.findOne({ email }), hasRosterAccess(email)]);
  let user = existingUser;
  const rosterAccess = Boolean(onRoster) || testAccount;

  if (user?.googleSubject && user.googleSubject !== payload.sub) {
    return next(new ErrorHandler("This account is already linked to a different Google identity", 403));
  }

  const teacherAccess = user?.role === "teacher" || isProvisionedTeacher(email);
  if (user?.role === "student" && !rosterAccess) {
    return next(new ErrorHandler("Your account is not on an active class roster", 403));
  }
  if (!user && !rosterAccess && !teacherAccess) {
    return next(new ErrorHandler("Your account is not on an active class roster. Ask your teacher to add this email.", 403));
  }

  if (!user) {
    user = await User.create({
      name: payload.name || email.split("@")[0],
      email,
      role: teacherAccess ? "teacher" : "student",
      authProvider: "google",
      googleSubject: payload.sub,
    });
  } else {
    user.googleSubject = payload.sub;
    user.authProvider = "google";
    if (!user.name && payload.name) user.name = payload.name;
    await user.save();
  }

  // Students bind this browser right after sign-in; hand them the one-time
  // challenge now so the browser skips a separate POST /device/challenge.
  const extra = user.role === "student" ? { deviceChallenge: await issueChallenge(user._id, "bind") } : {};
  sendToken(user, 200, res, extra);
});

exports.issueDeviceChallenge = catchAsyncError(async (req, res, next) => {
  if (req.user.role !== "student") {
    return next(new ErrorHandler("Only student devices sign attendance requests", 403));
  }
  const { purpose } = req.body;
  if (!PURPOSES.includes(purpose)) {
    return next(new ErrorHandler(`Purpose must be one of: ${PURPOSES.join(", ")}`, 400));
  }

  res.status(201).json({ success: true, ...(await issueChallenge(req.user._id, purpose)) });
});

exports.claimDeviceBinding = catchAsyncError(async (req, res, next) => {
  if (req.user.role !== "student") {
    return next(new ErrorHandler("Only student devices need attendance binding", 400));
  }

  const { publicKeyJwk, challengeId, signature } = req.body;
  const fingerprint = fingerprintPublicKey(publicKeyJwk);
  if (!fingerprint) {
    return next(new ErrorHandler("A valid P-256 device public key is required", 400));
  }

  // The browser must sign with the private half of the key it submits, so a
  // copied public key alone cannot claim a binding.
  const proof = await verifyDeviceProof({
    user: req.user,
    challengeId,
    signature,
    purpose: "bind",
    payload: { publicKey: { crv: publicKeyJwk.crv, kty: publicKeyJwk.kty, x: publicKeyJwk.x, y: publicKeyJwk.y } },
    publicKeyJwk,
  });
  if (!proof.ok) {
    return next(new ErrorHandler(proof.reason, 401));
  }

  const now = new Date();
  if (!req.user.deviceBinding?.fingerprint) {
    req.user.deviceBinding = {
      fingerprint,
      publicKeyJwk: req.body.publicKeyJwk,
      approvedAt: now,
      lastSeenAt: now,
    };
    req.user.markModified("deviceBinding");
    await req.user.save();
    // The identity-check status comes along so login needs no GET /enrollment/status.
    return res.status(201).json({ success: true, status: "approved", firstBinding: true, enrollment: enrollmentView(req.user) });
  }

  if (req.user.deviceBinding.fingerprint === fingerprint) {
    req.user.deviceBinding.lastSeenAt = now;
    await req.user.save();
    return res.status(200).json({ success: true, status: "approved", firstBinding: false, enrollment: enrollmentView(req.user) });
  }

  // Dev mode: any number of browsers. Trust this one at once (no review) and
  // keep its key so its signed requests verify alongside the bound phone's.
  if (isDevMode()) {
    const others = (req.user.deviceBinding.devKeys || []).filter((entry) => entry?.fingerprint !== fingerprint);
    req.user.deviceBinding.devKeys = [...others, { fingerprint, publicKeyJwk: req.body.publicKeyJwk, addedAt: now }].slice(-MAX_DEV_DEVICES);
    req.user.deviceBinding.lastSeenAt = now;
    req.user.markModified("deviceBinding");
    await req.user.save();
    return res.status(200).json({ success: true, status: "approved", firstBinding: false, devMode: true, enrollment: enrollmentView(req.user) });
  }

  const request = await DeviceBindingRequest.findOneAndUpdate(
    { student: req.user._id, fingerprint },
    {
      $set: { publicKeyJwk: req.body.publicKeyJwk, status: "pending" },
      $setOnInsert: { student: req.user._id, fingerprint },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // A verified student can approve the new phone with a quick face check (Phase 8).
  const faceVerifyAvailable = req.user.enrollment?.status === "verified" && Boolean(req.user.enrollment?.referenceFaceMedia);
  res.status(202).json({ success: true, status: "review", requestId: request._id, faceVerifyAvailable });
});

exports.getDeviceBindingStatus = catchAsyncError(async (req, res) => {
  // Dev mode: every signed-in browser is trusted, old pending requests don't matter.
  if (isDevMode()) {
    return res.status(200).json({ success: true, status: req.user.deviceBinding?.fingerprint ? "approved" : "unbound", devMode: true });
  }
  const pendingRequest = await DeviceBindingRequest.findOne({ student: req.user._id, status: "pending" }).sort({ updatedAt: -1 });
  res.status(200).json({
    success: true,
    status: pendingRequest ? "review" : req.user.deviceBinding?.fingerprint ? "approved" : "unbound",
  });
});

exports.listDeviceReviews = catchAsyncError(async (req, res) => {
  // Students on this teacher's rosters, plus test accounts (never on a roster).
  const visibleEmails = await reviewableStudentEmails(req.user._id);
  const students = await User.find({ email: { $in: visibleEmails }, role: "student" }).select("_id");
  const reviews = await DeviceBindingRequest.find({ student: { $in: students.map((student) => student._id) }, status: "pending" })
    .populate("student", "name email")
    .sort({ createdAt: 1 });

  res.status(200).json({ success: true, reviews });
});

exports.decideDeviceReview = catchAsyncError(async (req, res, next) => {
  const { decision } = req.body;
  if (!["approved", "rejected"].includes(decision)) {
    return next(new ErrorHandler("Decision must be approved or rejected", 400));
  }

  const review = await DeviceBindingRequest.findOne({ _id: req.params.reviewId, status: "pending" });
  if (!review || !(await teacherCanReviewStudent(req.user._id, review.student))) {
    return next(new ErrorHandler("Device review not found", 404));
  }

  await applyDeviceDecision(review, decision, req.user._id);
  res.status(200).json({ success: true, status: decision });
});

/**
 * Approve or reject a pending device request. reviewerId is null when the
 * system approves it (new phone matched the student's reference face).
 */
const applyDeviceDecision = async (review, decision, reviewerId) => {
  if (decision === "approved") {
    const student = await User.findById(review.student);
    student.deviceBinding = {
      fingerprint: review.fingerprint,
      publicKeyJwk: review.publicKeyJwk,
      approvedAt: new Date(),
      lastSeenAt: new Date(),
    };
    student.markModified("deviceBinding");
    await student.save();
  }

  review.status = decision;
  review.reviewedBy = reviewerId || undefined;
  review.reviewedAt = new Date();
  await review.save();

  if (decision === "approved") {
    // Only one device can be bound; close the student's other open requests.
    await DeviceBindingRequest.updateMany(
      { student: review.student, status: "pending", _id: { $ne: review._id } },
      { $set: { status: "superseded", reviewedBy: reviewerId || undefined, reviewedAt: new Date() } }
    );
  }
  await AuditLog.create({ actor: reviewerId || undefined, action: reviewerId ? `device_${decision}` : "device_auto_approved_by_face", target: { type: "DeviceBindingRequest", id: review._id } });
};

exports.applyDeviceDecision = applyDeviceDecision;
