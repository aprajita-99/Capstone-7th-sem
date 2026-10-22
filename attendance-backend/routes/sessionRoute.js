const express = require("express");
const isAuthenticated = require("../middleware/auth");
const {
  startSession,
  listClassSessions,
  getSession,
  getBeacon,
  closeSession,
  listActiveSessions,
  joinSession,
  claimKey,
  getMyRecord,
} = require("../controllers/sessionController");

const router = express.Router();
const teacher = [isAuthenticated, isAuthenticated.authorizeRoles("teacher")];
const student = [isAuthenticated, isAuthenticated.authorizeRoles("student")];

// Per-route guards (see classRoute.js for why there is no router.use()).
// /sessions/active must stay above /sessions/:sessionId.
router.route("/classes/:classId/sessions").get(teacher, listClassSessions).post(teacher, startSession);
router.get("/sessions/active", student, listActiveSessions);
router.get("/sessions/:sessionId", teacher, getSession);
router.get("/sessions/:sessionId/beacon", teacher, getBeacon);
router.post("/sessions/:sessionId/close", teacher, closeSession);
router.post("/sessions/:sessionId/join", student, joinSession);
router.post("/sessions/:sessionId/claims", student, claimKey);
router.get("/sessions/:sessionId/me", student, getMyRecord);

module.exports = router;
