const mongoose = require("mongoose");

// One row per roster student per session. `student` is empty for roster
// students who never signed in (they can still be marked absent).
const attendanceRecordSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "AttendanceSession", required: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: "CourseClass", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    email: { type: String, required: true, lowercase: true, trim: true },
    status: { type: String, enum: ["joined", "present", "review", "absent"], required: true },
    reasons: [String],
    joinedAt: Date,
    acoustic: {
      heard: { type: Boolean, default: false },
      wave: Number, // wave of the key the phone heard
      heardAt: Date,
    },
    device: {
      fingerprint: String,
      verified: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

attendanceRecordSchema.index({ session: 1, email: 1 }, { unique: true });
attendanceRecordSchema.index({ class: 1, email: 1 });

module.exports = mongoose.model("AttendanceRecord", attendanceRecordSchema);
