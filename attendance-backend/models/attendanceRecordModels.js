const mongoose = require("mongoose");

// One row per roster student per session. `student` is empty for roster
// students who never signed in (they can still be marked absent).
const attendanceRecordSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "AttendanceSession", required: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: "CourseClass", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    email: { type: String, required: true, lowercase: true, trim: true },
    // heard = key heard, face check still to come (Phase 9)
    status: { type: String, enum: ["joined", "heard", "present", "review", "absent"], required: true },
    // not_heard, face_*, device_unverified, not_joined, student_query (Phase 10), unresolved (locked undecided)
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
    // Face + liveness at check-in (Phase 9)
    face: {
      status: { type: String, enum: ["passed", "unsure", "mismatch", "not_live", "missing"] },
      similarity: Number,
      liveness: Number,
      attempts: { type: Number, default: 0 },
      checkedAt: Date,
    },
    relayedAt: Date,
    // Teacher's decision (review case, student query or override) or the lock's (Phase 10)
    decision: {
      status: { type: String, enum: ["present", "absent"] },
      kind: { type: String, enum: ["review", "query", "override", "lock"] },
      from: String, // status before the decision
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      at: Date,
      note: String, // teacher only; never shown to the student
    },
    // Student query (Phase 10): once per record, until the lock
    query: {
      reason: { type: String, enum: ["cant_hear", "camera_failed", "was_present", "other"] },
      text: String, // cleared after AUDIT_RETENTION_DAYS
      raisedAt: Date,
      fromStatus: String,
    },
  },
  { timestamps: true }
);

attendanceRecordSchema.index({ session: 1, email: 1 }, { unique: true });
attendanceRecordSchema.index({ class: 1, email: 1 });

module.exports = mongoose.model("AttendanceRecord", attendanceRecordSchema);
