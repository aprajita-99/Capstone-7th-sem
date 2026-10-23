const mongoose = require("mongoose");

// Secondary check-in data (IP, browser, the check-in face frame). Short retention: MongoDB deletes it
// automatically at expiresAt (TTL index), default 24 hours.
const checkinEvidenceSchema = new mongoose.Schema(
  {
    record: { type: mongoose.Schema.Types.ObjectId, ref: "AttendanceRecord", required: true, index: true },
    ip: String,
    userAgent: String,
    frame: Buffer, // live frame from the check-in face check (Phase 9)
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

checkinEvidenceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("CheckinEvidence", checkinEvidenceSchema);
