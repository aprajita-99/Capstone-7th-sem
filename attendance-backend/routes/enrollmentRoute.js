const express = require("express");
const isAuthenticated = require("../middleware/auth");
const {
  getStatus,
  acceptConsent,
  uploadIdCard,
  submitSelfie,
  getMedia,
  verifyDeviceByFace,
  listEnrollmentReviews,
  decideEnrollment,
  resetAttempts,
  forceReenroll,
  classEnrollmentStatus,
} = require("../controllers/enrollmentController");

const router = express.Router();
const student = [isAuthenticated, isAuthenticated.authorizeRoles("student")];
const teacher = [isAuthenticated, isAuthenticated.authorizeRoles("teacher")];
// ID card photos arrive as base64 data URLs (≤ 600 KB image ≈ 800 KB text).
const imageBody = express.json({ limit: "1mb" });

router.get("/enrollment/status", student, getStatus);
router.post("/enrollment/consent", student, acceptConsent);
router.post("/enrollment/id-card", imageBody, student, uploadIdCard);
router.post("/enrollment/selfie", student, submitSelfie);
router.post("/device-bindings/face-verify", student, verifyDeviceByFace);
router.get("/media/:mediaId", isAuthenticated, getMedia);

router.get("/enrollment-reviews", teacher, listEnrollmentReviews);
router.post("/enrollment-reviews/:userId", teacher, decideEnrollment);
router.post("/enrollment-reviews/:userId/reset-attempts", teacher, resetAttempts);
router.post("/enrollment-reviews/:userId/force-reenroll", teacher, forceReenroll);
router.get("/classes/:classId/enrollment-status", teacher, classEnrollmentStatus);

module.exports = router;
