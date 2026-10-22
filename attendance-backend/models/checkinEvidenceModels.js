const mongoose = require("mongoose");

// Secondary check-in data (IP, browser). Short retention: MongoDB deletes it
// automatically at expiresAt (TTL index), default 24 hours.
const checkinEvidenceSchema = new mongoose.Schema(
  {
    record: { type: mongoose.Schema.Types.ObjectId, ref: "AttendanceRecord", required: true, index: true },
    ip: String,
    userAgent: String,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

checkinEvidenceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("CheckinEvidence", checkinEvidenceSchema);
