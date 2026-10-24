const express = require("express");
const isAuthenticated = require("../middleware/auth");
const { listAttendanceReviews, reviewCounts, decideRecord, bulkDecide, raiseQuery, recentCheckins } = require("../controllers/reviewController");

const router = express.Router();
const teacher = [isAuthenticated, isAuthenticated.authorizeRoles("teacher")];
const student = [isAuthenticated, isAuthenticated.authorizeRoles("student")];

// Phase 10: attendance reviews, decisions / overrides, student queries.
router.get("/reviews", teacher, listAttendanceReviews);
router.get("/reviews/counts", teacher, reviewCounts);
router.post("/records/bulk-decision", teacher, bulkDecide);
router.post("/records/:recordId/decision", teacher, decideRecord);
router.post("/records/:recordId/query", student, raiseQuery);
router.get("/me/recent-checkins", student, recentCheckins);

module.exports = router;
