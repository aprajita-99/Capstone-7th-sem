const mongoose = require("mongoose");

// One attendance-taking window for one class.
const attendanceSessionSchema = new mongoose.Schema(
  {
    class: { type: mongoose.Schema.Types.ObjectId, ref: "CourseClass", required: true, index: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
    status: { type: String, enum: ["open", "closed", "locked"], default: "open", index: true },
    startedAt: { type: Date, required: true },
    closesAt: { type: Date, required: true },
    closedAt: Date,
    lockAt: { type: Date, required: true }, // 09:00 local the next morning (Phase 10); then status "locked"
    lockedAt: Date,
    settings: {
      windowMin: Number,
      keyLifetimeSec: Number,
      maxWaves: Number,
      profile: { type: String, enum: ["high", "mid"] },
      faceRequired: { type: Boolean, default: true }, // every check-in includes the face check (Phase 9)
    },
    headcount: { count: Number, at: Date }, // teacher's head count (Phase 10)
    stats: {
      joined: { type: Number, default: 0 },
      heard: { type: Number, default: 0 },
      present: { type: Number, default: 0 },
      review: { type: Number, default: 0 },
      absent: { type: Number, default: 0 },
      byWave: { type: mongoose.Schema.Types.Mixed, default: {} }, // present students per wave
    },
  },
  { timestamps: true }
);

// At most one open check-in per class.
attendanceSessionSchema.index({ class: 1 }, { unique: true, partialFilterExpression: { status: "open" }, name: "one_open_session_per_class" });

module.exports = mongoose.model("AttendanceSession", attendanceSessionSchema);
