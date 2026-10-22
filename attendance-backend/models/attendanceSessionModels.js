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
    lockAt: { type: Date, required: true }, // end of the local day; locking itself arrives in Phase 10
    settings: {
      windowMin: Number,
      keyLifetimeSec: Number,
      maxWaves: Number,
      profile: { type: String, enum: ["high", "mid"] },
      faceRequired: { type: Boolean, default: false },
    },
    stats: {
      joined: { type: Number, default: 0 },
      present: { type: Number, default: 0 },
      review: { type: Number, default: 0 },
      absent: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// At most one open check-in per class.
attendanceSessionSchema.index({ class: 1 }, { unique: true, partialFilterExpression: { status: "open" }, name: "one_open_session_per_class" });

module.exports = mongoose.model("AttendanceSession", attendanceSessionSchema);
