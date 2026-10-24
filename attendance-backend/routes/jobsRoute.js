const express = require("express");
const { runJobsRoute } = require("../controllers/jobsController");

const router = express.Router();

// Scheduled work (lock, retention, evening digest). Called by the GitHub
// Actions cron with the x-jobs-secret header; no user session.
router.post("/jobs/run", runJobsRoute);

module.exports = router;
