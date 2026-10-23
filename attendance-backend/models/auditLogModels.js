const mongoose = require("mongoose");

// Who changed what (teacher decisions on enrollments, devices, attendance).
const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // empty = the system (e.g. auto-approval)
  action: { type: String, required: true },
  target: { type: { type: String }, id: mongoose.Schema.Types.ObjectId },
  note: String,
  at: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
