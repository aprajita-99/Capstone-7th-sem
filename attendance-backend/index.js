//------for port from env file--------
const dotenv = require('dotenv');
if (process.env.NODE_ENV !== "PRODUCTION") {
    dotenv.config({ path: "./config/config.env" });
}

// Load environment values before importing routes/controllers that read them.
const app = require('./app');
const connectdatabase = require("./config/database");

app.get("/", (req, res) => {
    res.json("Hello");
});

connectdatabase();

const server = app.listen(process.env.PORT, () => {
    console.log(`server is working at http://localhost:${process.env.PORT}`);
});

// Close check-ins whose window has ended even if nobody opens them again.
const { sweepExpiredSessions } = require("./controllers/sessionController");
setInterval(() => {
    sweepExpiredSessions().catch((err) => console.log(`session sweep failed: ${err.message}`));
}, 60 * 1000).unref();

// Lock, retention and the evening digest (Phase 10). The GitHub Actions cron
// calls POST /api/v1/jobs/run as well, because a free Render instance sleeps.
const { runJobs } = require("./controllers/jobsController");
setInterval(() => {
    runJobs().catch((err) => console.log(`jobs run failed: ${err.message}`));
}, 10 * 60 * 1000).unref();

//handling uncaught exception
process.on("uncaughtException", err => {
    console.log(`Error:${err.message}`);
    console.log("shutting down server due to uncaught error")
    server.close(() => {
        process.exit(1);
    })
})
//unhandled promise rejection
process.on("unhandledRejection", err => {
    console.log(`Error:${err.message}`);
    console.log("shutting down server due to unhandled error")
    server.close(() => {
        process.exit(1);
    })
})
