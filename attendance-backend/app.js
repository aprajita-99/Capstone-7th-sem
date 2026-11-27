const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const compression = require('compression');
const serveWebsite = require('./utils/serveWebsite');

const app = express();

// gzip JSON and website files (the main script is ~4x smaller compressed).
app.use(compression());

// Browser origins allowed to call this API with cookies.
// Add exact origins (deployments) with CLIENT_URLS=origin1,origin2 in config.env.
// In production only CLIENT_URL / CLIENT_URLS are allowed: production cookies
// are SameSite=None, so a loose origin rule there would let other sites make
// signed-in requests.
const isProduction = ["PRODUCTION", "production"].includes(process.env.NODE_ENV);
const developmentOrigins = [
  "http://localhost:3000", // React development server
  "http://127.0.0.1:3000", // Same server, alternate host name
];
const allowedOrigins = new Set(
  [...(isProduction ? [] : developmentOrigins), process.env.CLIENT_URL, ...String(process.env.CLIENT_URLS || "").split(",")]
    .map((origin) => String(origin || "").trim().replace(/\/+$/, ""))
    .filter(Boolean)
);
// Shared quick tunnels used for phone testing get a fresh random host each run
// (development only).
const sharedTunnelOrigin = isProduction ? null : /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: curl, the React development proxy, server-to-server.
      if (!origin) return callback(null, true);
      const normalisedOrigin = origin.replace(/\/+$/, "");
      if (allowedOrigins.has(normalisedOrigin) || sharedTunnelOrigin?.test(normalisedOrigin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"], // CSV exports name their file (Phase 11)
    credentials: true, // Allow credentials (cookies, headers)
  })
);

app.use(cookieParser());
// Default 100 kB JSON limit everywhere except the ID-card upload, which parses
// its own body with a 1 MB limit (routes/enrollmentRoute.js).
const jsonBody = express.json();
const LARGE_BODY_PATHS = new Set(["/api/v1/enrollment/id-card"]);
app.use((req, res, next) => (LARGE_BODY_PATHS.has(req.path) ? next() : jsonBody(req, res, next)));

app.set('trust proxy', true); // Add this in your main Express config

const userRoute = require('./routes/userRoute');
app.use("/api/v1", userRoute);

const classRoute = require('./routes/classRoute');
app.use("/api/v1", classRoute);

const googleAuthRoute = require('./routes/googleAuthRoute');
app.use("/api/v1", googleAuthRoute);

const meRoute = require('./routes/meRoute');
app.use("/api/v1", meRoute);

const sessionRoute = require('./routes/sessionRoute');
app.use("/api/v1", sessionRoute);

const faceRoute = require('./routes/faceRoute');
app.use("/api/v1", faceRoute);

const enrollmentRoute = require('./routes/enrollmentRoute');
app.use("/api/v1", enrollmentRoute);

const reviewRoute = require('./routes/reviewRoute');
app.use("/api/v1", reviewRoute);

const reportRoute = require('./routes/reportRoute');
app.use("/api/v1", reportRoute);

const jobsRoute = require('./routes/jobsRoute');
app.use("/api/v1", jobsRoute);

// The website itself (attendance-frontend/build), when it was built on this
// server. Same address as the API: no proxy hop, first-party login cookie.
serveWebsite(app);

const errorMiddleware = require('./middleware/error');
app.use(errorMiddleware);

module.exports = app;
