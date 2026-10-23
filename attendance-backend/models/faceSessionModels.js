const mongoose = require("mongoose");

// Binds one AWS Face Liveness session to one user and one purpose, so a
// session id cannot be reused by someone else or read twice. Deleted by a TTL
// index shortly after AWS's own session expiry (3 minutes).
const faceSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: { type: String, enum: ["test", "enroll", "checkin"], required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "AttendanceSession" }, // check-in only
    awsSessionId: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    result: {
      status: String,
      confidence: Number,
      verdict: String,
    },
    referenceImage: Buffer, // the live frame, kept only until this document expires
  },
  { timestamps: true }
);

faceSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("FaceSession", faceSessionSchema);
