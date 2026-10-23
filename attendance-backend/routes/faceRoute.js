const express = require("express");
const isAuthenticated = require("../middleware/auth");
const { startLivenessSession, getTestResult } = require("../controllers/faceController");

const router = express.Router();

router.post("/face/liveness-session", isAuthenticated, startLivenessSession);
router.post("/face/test-result", isAuthenticated, getTestResult);

module.exports = router;
