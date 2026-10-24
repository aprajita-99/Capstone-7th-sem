const mongoose = require("mongoose");

const retentionMs = () => {
  const days = Number(process.env.AUDIT_RETENTION_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 180) * 24 * 60 * 60 * 1000;
};

// Who changed what (teacher decisions on enrollments, devices, attendance; system lock actions).
// Deleted automatically after AUDIT_RETENTION_DAYS (default 180) by the TTL index on expiresAt.
const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // empty = the system (e.g. auto-approval, lock)
  action: { type: String, required: true },
  target: { type: { type: String }, id: mongoose.Schema.Types.ObjectId },
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  note: String,
  at: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, default: () => new Date(Date.now() + retentionMs()) },
});

auditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
module.exports.retentionMs = retentionMs;
