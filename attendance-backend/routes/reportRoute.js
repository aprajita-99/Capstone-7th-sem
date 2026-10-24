const express = require("express");
const isAuthenticated = require("../middleware/auth");
const { classAttendance, classAttendanceCsv, sessionCsv, teacherSummary, myAttendance } = require("../controllers/reportController");

const router = express.Router();
const teacher = [isAuthenticated, isAuthenticated.authorizeRoles("teacher")];
const student = [isAuthenticated, isAuthenticated.authorizeRoles("student")];

// Phase 11: attendance reports and CSV exports.
router.get("/classes/:classId/attendance.csv", teacher, classAttendanceCsv);
router.get("/classes/:classId/attendance", teacher, classAttendance);
router.get("/sessions/:sessionId/export.csv", teacher, sessionCsv);
router.get("/reports/summary", teacher, teacherSummary);
router.get("/me/attendance", student, myAttendance);

module.exports = router;
