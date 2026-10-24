const mongoose = require("mongoose");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const User = require("../models/userModels");
const CourseClass = require("../models/classModels");
const Enrollment = require("../models/enrollmentModels");
const IdentityMedia = require("../models/identityMediaModels");
const DeviceBindingRequest = require("../models/deviceBindingRequestModels");
const AuditLog = require("../models/auditLogModels");
const faceClient = require("../utils/faceClient");
const { consumeFaceSession } = require("../utils/faceSessions");
const { verifyDeviceProof } = require("../utils/deviceProof");
const { isTestStudent } = require("../utils/signInPolicy");
const { reviewableStudentEmails, teacherCanReviewStudent } = require("../utils/teacherAccess");
const { MAX_ATTEMPTS, CONSENT_VERSION, loginIdFromEmail, textContainsRoll, enrollmentDecision, parseImageDataUrl } = require("../utils/enrollment");
const { applyDeviceDecision } = require("./googleAuthController");

const requireFace = (next) => {
  if (faceClient.isConfigured()) return true;
  next(new ErrorHandler("Face checks are not configured on the server", 503));
  return false;
};

const enrollmentView = (user) => {
  const enrollment = user.enrollment || {};
  return {
    status: enrollment.status || "none",
    attempts: enrollment.attempts || 0,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - (enrollment.attempts || 0)),
    maxAttempts: MAX_ATTEMPTS,
    reasons: enrollment.reasons || [],
    rejectReason: enrollment.rejectReason || null,
    idCardUploaded: Boolean(enrollment.idCardMedia),
    idCheck: enrollment.idCheck || null,
    consentRequired: user.consent?.version !== CONSENT_VERSION,
    consentVersion: CONSENT_VERSION,
    verifiedAt: enrollment.verifiedAt || null,
  };
};

const saveMedia = (userId, kind, contentType, buffer) =>
  IdentityMedia.create({ user: userId, kind, contentType, data: buffer, size: buffer.length });

const deleteMedia = async (...ids) => {
  const real = ids.filter(Boolean);
  if (real.length) await IdentityMedia.deleteMany({ _id: { $in: real } });
};

// Plain copy of the stored enrollment, safe to modify and save back.
const currentEnrollment = (user) => ({ ...(user.toObject().enrollment || {}) });

const canSubmit = (user) => ["none", "rejected", undefined].includes(user.enrollment?.status);

// ---------- student ----------

exports.getStatus = catchAsyncError(async (req, res) => {
  res.status(200).json({ success: true, enrollment: enrollmentView(req.user) });
});

exports.acceptConsent = catchAsyncError(async (req, res, next) => {
  if (req.body?.version !== CONSENT_VERSION) return next(new ErrorHandler("Please read the latest notice and accept it", 400));
  req.user.consent = { version: CONSENT_VERSION, acceptedAt: new Date() };
  await req.user.save();
  res.status(200).json({ success: true, enrollment: enrollmentView(req.user) });
});

// Stores the ID card after checking it has one face and readable text; no attempt is used.
exports.uploadIdCard = catchAsyncError(async (req, res, next) => {
  if (!requireFace(next)) return;
  const user = req.user;
  if (user.consent?.version !== CONSENT_VERSION) return next(new ErrorHandler("Accept the consent notice first", 400));
  if (!canSubmit(user)) return next(new ErrorHandler("Your identity check is already submitted", 409));
  if ((user.enrollment?.attempts || 0) >= MAX_ATTEMPTS) return next(new ErrorHandler("No attempts left. Ask your teacher to reset your identity check.", 403));

  const image = parseImageDataUrl(req.body?.image);
  if (image.error) return next(new ErrorHandler(image.error, 400));

  const [faces, lines] = await Promise.all([faceClient.detectFaces(image.buffer), faceClient.detectText(image.buffer)]);
  if (faces !== 1) {
    return next(new ErrorHandler(faces === 0 ? "No face found on the ID card. Take a clearer, well-lit photo of the front." : "More than one face found. Photograph only your ID card.", 422));
  }
  if (lines.length === 0) return next(new ErrorHandler("No readable text on the ID card. Take a sharper photo without glare.", 422));

  const testAccount = isTestStudent(user.email);
  const rollMatch = testAccount ? null : textContainsRoll(lines, loginIdFromEmail(user.email));

  const previous = user.enrollment?.idCardMedia;
  const media = await saveMedia(user._id, "id_card", image.contentType, image.buffer);
  user.enrollment = {
    ...currentEnrollment(user),
    status: user.enrollment?.status === "rejected" ? "rejected" : "none",
    idCardMedia: media._id,
    idCheck: { faces, hasText: true, rollMatch },
  };
  user.markModified("enrollment");
  await user.save();
  await deleteMedia(previous);

  res.status(200).json({ success: true, rollMatch, testAccount, enrollment: enrollmentView(user) });
});

// Live selfie (AWS liveness) compared with the ID card; signed by the bound phone; uses one attempt.
exports.submitSelfie = catchAsyncError(async (req, res, next) => {
  if (!requireFace(next)) return;
  const user = req.user;
  if (!canSubmit(user)) return next(new ErrorHandler("Your identity check is already submitted", 409));
  if ((user.enrollment?.attempts || 0) >= MAX_ATTEMPTS) return next(new ErrorHandler("No attempts left. Ask your teacher to reset your identity check.", 403));
  if (!user.enrollment?.idCardMedia) return next(new ErrorHandler("Upload your college ID card first", 400));

  const { livenessSessionId, challengeId, signature } = req.body || {};
  const proof = await verifyDeviceProof({ user, challengeId, signature, purpose: "face", payload: { livenessSessionId: String(livenessSessionId || "") } });
  if (!proof.ok) return next(new ErrorHandler(`${proof.reason}. Enroll from your approved phone.`, 401));

  const faceSession = await consumeFaceSession({ awsSessionId: livenessSessionId, user, purpose: "enroll" });
  if (!faceSession) return next(new ErrorHandler("Face check expired or already used, please start again", 404));

  const liveness = await faceClient.getLivenessResult(faceSession.awsSessionId);
  const idCard = await IdentityMedia.findById(user.enrollment.idCardMedia);
  const comparison = liveness.verdict === "live" && liveness.referenceImage && idCard
    ? await faceClient.compareFaces(idCard.data, liveness.referenceImage)
    : { similarity: 0, decision: "no_match" };

  const testAccount = isTestStudent(user.email);
  const decision = enrollmentDecision({
    livenessVerdict: liveness.verdict,
    matchDecision: comparison.decision,
    rollMatch: user.enrollment.idCheck?.rollMatch ?? null,
    testAccount,
  });

  const enrollment = currentEnrollment(user);
  enrollment.attempts = (enrollment.attempts || 0) + 1;
  enrollment.scores = { liveness: liveness.confidence, similarity: comparison.similarity };
  enrollment.reasons = decision.reasons;
  enrollment.rejectReason = undefined;

  if (decision.outcome === "verified") {
    const reference = await saveMedia(user._id, "reference_face", "image/jpeg", liveness.referenceImage);
    // Retention: once verified only the reference face is kept; the ID card is deleted.
    await deleteMedia(enrollment.referenceFaceMedia, enrollment.selfieMedia, enrollment.idCardMedia);
    Object.assign(enrollment, { status: "verified", referenceFaceMedia: reference._id, selfieMedia: undefined, idCardMedia: undefined, verifiedAt: new Date(), decidedBy: undefined, decidedAt: new Date() });
  } else if (decision.outcome === "pending") {
    const selfie = await saveMedia(user._id, "selfie", "image/jpeg", liveness.referenceImage);
    await deleteMedia(enrollment.selfieMedia);
    Object.assign(enrollment, { status: "pending", selfieMedia: selfie._id });
  } else {
    // Not live: likely a photo or screen. Stays open for another attempt.
    enrollment.status = enrollment.status === "rejected" ? "rejected" : "none";
  }

  user.enrollment = enrollment;
  user.markModified("enrollment");
  await user.save();
  if (decision.outcome === "verified") {
    await AuditLog.create({ action: "enrollment_auto_verified", target: { type: "User", id: user._id }, note: `similarity ${comparison.similarity.toFixed(1)}` });
  }

  res.status(200).json({ success: true, outcome: decision.outcome, enrollment: enrollmentView(user) });
});

// Private identity images: the owner, or a teacher of one of their classes.
exports.getMedia = catchAsyncError(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.mediaId)) return next(new ErrorHandler("Image not found", 404));
  const media = await IdentityMedia.findById(req.params.mediaId);
  if (!media) return next(new ErrorHandler("Image not found", 404));
  const own = media.user.equals(req.user._id);
  const teacherAllowed = req.user.role === "teacher" && (await teacherCanReviewStudent(req.user._id, media.user));
  if (!own && !teacherAllowed) return next(new ErrorHandler("You cannot view this image", 403));
  res.set({ "Content-Type": media.contentType, "Cache-Control": "private, no-store" });
  res.send(media.data);
});

// New phone of a verified student: liveness on the new phone vs the saved reference face.
exports.verifyDeviceByFace = catchAsyncError(async (req, res, next) => {
  if (!requireFace(next)) return;
  const user = req.user;
  const { requestId, livenessSessionId, challengeId, signature } = req.body || {};
  if (!mongoose.isValidObjectId(requestId)) return next(new ErrorHandler("No pending phone change to verify", 404));
  const request = await DeviceBindingRequest.findOne({ _id: requestId, student: user._id, status: "pending" });
  if (!request) return next(new ErrorHandler("No pending phone change to verify", 404));
  if (user.enrollment?.status !== "verified" || !user.enrollment.referenceFaceMedia) {
    return next(new ErrorHandler("Your identity is not verified yet; your teacher will approve this phone", 409));
  }

  // Signed by the NEW phone's key (the one waiting for approval).
  const proof = await verifyDeviceProof({ user, challengeId, signature, purpose: "face", payload: { livenessSessionId: String(livenessSessionId || "") }, publicKeyJwk: request.publicKeyJwk });
  if (!proof.ok) return next(new ErrorHandler(proof.reason, 401));

  const faceSession = await consumeFaceSession({ awsSessionId: livenessSessionId, user, purpose: "rebind" });
  if (!faceSession || String(faceSession.deviceRequest) !== String(request._id)) {
    return next(new ErrorHandler("Face check expired or already used, please start again", 404));
  }

  const liveness = await faceClient.getLivenessResult(faceSession.awsSessionId);
  const reference = await IdentityMedia.findById(user.enrollment.referenceFaceMedia);
  const comparison = liveness.verdict === "live" && liveness.referenceImage && reference
    ? await faceClient.compareFaces(reference.data, liveness.referenceImage)
    : { similarity: 0, decision: "no_match" };

  if (liveness.verdict === "live" && comparison.decision === "match") {
    await applyDeviceDecision(request, "approved", null);
    return res.status(200).json({ success: true, status: "approved" });
  }
  res.status(200).json({ success: true, status: "review", reason: liveness.verdict !== "live" ? "not_live" : "face_not_matched" });
});

// ---------- teacher ----------

const reviewRow = async (student) => {
  const roster = await Enrollment.findOne({ email: student.email, status: "active" }).select("name identity");
  const enrollment = student.enrollment || {};
  return {
    userId: student._id,
    name: roster?.name || student.name,
    email: student.email,
    rollNumber: roster?.identity?.loginId || loginIdFromEmail(student.email),
    status: enrollment.status || "none",
    attempts: enrollment.attempts || 0,
    scores: enrollment.scores || null,
    idCheck: enrollment.idCheck || null,
    reasons: enrollment.reasons || [],
    idCardMedia: enrollment.idCardMedia || null,
    selfieMedia: enrollment.selfieMedia || null,
    referenceFaceMedia: enrollment.referenceFaceMedia || null,
  };
};

exports.listEnrollmentReviews = catchAsyncError(async (req, res) => {
  const emails = await reviewableStudentEmails(req.user._id);
  const [pending, blocked] = await Promise.all([
    User.find({ email: { $in: emails }, role: "student", "enrollment.status": "pending" }).sort({ updatedAt: 1 }),
    // Out of attempts: only a teacher reset lets them try again.
    User.find({ email: { $in: emails }, role: "student", "enrollment.status": { $in: ["none", "rejected"] }, "enrollment.attempts": { $gte: MAX_ATTEMPTS } }),
  ]);
  res.status(200).json({
    success: true,
    reviews: await Promise.all(pending.map(reviewRow)),
    blocked: await Promise.all(blocked.map(reviewRow)),
  });
});

const loadReviewableStudent = async (req, next) => {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId) || !(await teacherCanReviewStudent(req.user._id, userId))) {
    next(new ErrorHandler("Student not found", 404));
    return null;
  }
  return User.findById(userId);
};

exports.decideEnrollment = catchAsyncError(async (req, res, next) => {
  const { decision } = req.body || {};
  const reason = String(req.body?.reason || "").trim().slice(0, 300);
  if (!["approved", "rejected"].includes(decision)) return next(new ErrorHandler("Decision must be approved or rejected", 400));
  if (decision === "rejected" && !reason) return next(new ErrorHandler("Give the student a reason for the rejection", 400));

  const student = await loadReviewableStudent(req, next);
  if (!student) return;
  if (student.enrollment?.status !== "pending") return next(new ErrorHandler("This identity check is not waiting for review", 409));

  const enrollment = currentEnrollment(student);
  if (decision === "approved") {
    const selfie = await IdentityMedia.findById(enrollment.selfieMedia);
    if (!selfie) return next(new ErrorHandler("The live selfie is missing; force a re-enrollment instead", 409));
    selfie.kind = "reference_face";
    await selfie.save();
    await deleteMedia(enrollment.referenceFaceMedia, enrollment.idCardMedia); // ID card not kept after verification
    Object.assign(enrollment, { status: "verified", referenceFaceMedia: selfie._id, selfieMedia: undefined, idCardMedia: undefined, verifiedAt: new Date() });
  } else {
    await deleteMedia(enrollment.selfieMedia, enrollment.idCardMedia);
    Object.assign(enrollment, { status: "rejected", rejectReason: reason, selfieMedia: undefined, idCardMedia: undefined, idCheck: undefined });
  }
  Object.assign(enrollment, { decidedBy: req.user._id, decidedAt: new Date() });
  student.enrollment = enrollment;
  student.markModified("enrollment");
  await student.save();
  await AuditLog.create({ actor: req.user._id, action: `enrollment_${decision}`, target: { type: "User", id: student._id }, note: reason || undefined });

  res.status(200).json({ success: true, review: await reviewRow(student) });
});

exports.resetAttempts = catchAsyncError(async (req, res, next) => {
  const student = await loadReviewableStudent(req, next);
  if (!student) return;
  student.enrollment = { ...currentEnrollment(student), attempts: 0 };
  student.markModified("enrollment");
  await student.save();
  await AuditLog.create({ actor: req.user._id, action: "enrollment_attempts_reset", target: { type: "User", id: student._id } });
  res.status(200).json({ success: true, review: await reviewRow(student) });
});

exports.forceReenroll = catchAsyncError(async (req, res, next) => {
  const student = await loadReviewableStudent(req, next);
  if (!student) return;
  await IdentityMedia.deleteMany({ user: student._id });
  student.enrollment = { status: "none", attempts: 0, reasons: [] };
  student.markModified("enrollment");
  await student.save();
  await AuditLog.create({ actor: req.user._id, action: "enrollment_force_reenroll", target: { type: "User", id: student._id } });
  res.status(200).json({ success: true, review: await reviewRow(student) });
});

exports.classEnrollmentStatus = catchAsyncError(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.classId)) return next(new ErrorHandler("Class not found", 404));
  const courseClass = await CourseClass.findOne({ _id: req.params.classId, teacher: req.user._id });
  if (!courseClass) return next(new ErrorHandler("Class not found", 404));
  const roster = await Enrollment.find({ class: courseClass._id, status: "active" }).select("email");
  const students = await User.find({ email: { $in: roster.map((row) => row.email) } }).select("email enrollment.status enrollment.attempts");
  const byEmail = new Map(students.map((student) => [student.email, student]));
  res.status(200).json({
    success: true,
    maxAttempts: MAX_ATTEMPTS,
    statuses: Object.fromEntries(roster.map((row) => {
      const student = byEmail.get(row.email);
      return [row.email, student
        ? { status: student.enrollment?.status || "none", attempts: student.enrollment?.attempts || 0, userId: student._id }
        : { status: "not_signed_in", attempts: 0, userId: null }];
    })),
  });
});

// Retention: identity images of students who are no longer on any active roster are deleted.
exports.purgeOffRosterIdentities = async (emails) => {
  for (const email of emails) {
    if (isTestStudent(email) || (await Enrollment.exists({ email, status: "active" }))) continue;
    const student = await User.findOne({ email });
    if (!student?.enrollment || student.enrollment.status === "none" && !student.enrollment.idCardMedia) continue;
    await IdentityMedia.deleteMany({ user: student._id });
    student.enrollment = { status: "none", attempts: 0, reasons: [] };
    student.markModified("enrollment");
    await student.save();
  }
};
