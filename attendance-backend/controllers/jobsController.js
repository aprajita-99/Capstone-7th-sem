const crypto = require("crypto");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const User = require("../models/userModels");
const CourseClass = require("../models/classModels");
const AttendanceSession = require("../models/attendanceSessionModels");
const AttendanceRecord = require("../models/attendanceRecordModels");
const IdentityMedia = require("../models/identityMediaModels");
const AuditLog = require("../models/auditLogModels");
const mailer = require("../utils/mailer");
const { endOfDay, lockTimeFor, localDay, localHour, timeZone } = require("../utils/clock");
const { sweepExpiredSessions, lockDueSessions } = require("./sessionController");

const digestHour = () => {
  const hour = Number(process.env.DIGEST_HOUR);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 20;
};

const appUrl = () => process.env.APP_URL || process.env.CLIENT_URL || "";

// Constant-time comparison of the x-jobs-secret header with JOBS_SECRET.
const secretMatches = (given, expected) => {
  if (!expected || typeof given !== "string") return false;
  const left = crypto.createHash("sha256").update(given).digest();
  const right = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(left, right);
};

// Check-ins created before Phase 10 locked at the end of their day; move them to 09:00 the next morning.
const retimeOldSessions = async () => {
  const sessions = await AttendanceSession.find({ status: { $in: ["open", "closed"] } }).select("startedAt lockAt");
  let moved = 0;
  for (const session of sessions) {
    if (session.lockAt.getTime() !== endOfDay(session.startedAt).getTime()) continue;
    session.lockAt = lockTimeFor(session.startedAt);
    await session.save();
    moved += 1;
  }
  return moved;
};

// Retention (Phase 10): query text and old audit rows after AUDIT_RETENTION_DAYS; ID cards once identity is verified.
const runRetention = async () => {
  const cutoff = new Date(Date.now() - AuditLog.retentionMs());
  const queries = await AttendanceRecord.updateMany({ "query.raisedAt": { $lt: cutoff }, "query.text": { $exists: true } }, { $unset: { "query.text": "" } });
  const audits = await AuditLog.updateMany({ expiresAt: { $exists: false } }, [{ $set: { expiresAt: { $add: ["$at", AuditLog.retentionMs()] } } }]);

  const verified = await User.find({ "enrollment.status": "verified", "enrollment.idCardMedia": { $exists: true, $ne: null } }).select("enrollment");
  for (const student of verified) {
    await IdentityMedia.deleteOne({ _id: student.enrollment.idCardMedia });
    await User.updateOne({ _id: student._id }, { $unset: { "enrollment.idCardMedia": "" } });
  }
  return { queryTextsCleared: queries.modifiedCount, auditRowsDated: audits.modifiedCount, idCardsDeleted: verified.length };
};

// Evening digest: one email per teacher with open attendance reviews, at most once per local day.
const sendDigests = async (now = new Date()) => {
  if (localHour(now) < digestHour()) return { due: false, sent: 0 };
  const day = localDay(now);
  const sessions = await AttendanceSession.find({ status: { $in: ["open", "closed"] }, lockAt: { $gt: now } });
  if (sessions.length === 0) return { due: true, sent: 0 };

  const counts = await AttendanceRecord.aggregate([
    { $match: { session: { $in: sessions.map((session) => session._id) }, status: "review" } },
    { $group: { _id: "$session", reviews: { $sum: 1 }, queries: { $sum: { $cond: [{ $ifNull: ["$query.raisedAt", false] }, 1, 0] } } } },
  ]);
  const countBySession = new Map(counts.map((row) => [String(row._id), row]));
  const classes = await CourseClass.find({ _id: { $in: sessions.map((session) => session.class) } }).select("courseCode title section");
  const classById = new Map(classes.map((courseClass) => [String(courseClass._id), courseClass]));

  const byTeacher = new Map();
  for (const session of sessions) {
    const count = countBySession.get(String(session._id));
    if (!count) continue;
    const courseClass = classById.get(String(session.class));
    const list = byTeacher.get(String(session.teacher)) || [];
    list.push({ courseCode: courseClass?.courseCode || "Class", section: courseClass?.section, title: courseClass?.title, startedAt: session.startedAt, lockAt: session.lockAt, reviews: count.reviews, queries: count.queries });
    byTeacher.set(String(session.teacher), list);
  }

  const formatTime = (date) => new Intl.DateTimeFormat("en-IN", { timeZone: timeZone(), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  let sent = 0;
  for (const [teacherId, groups] of byTeacher) {
    if (await AuditLog.exists({ action: "email_digest_sent", "target.id": teacherId, note: day })) continue;
    const teacher = await User.findById(teacherId).select("name email");
    if (!teacher) continue;
    const message = mailer.buildDigest({ teacherName: teacher.name, groups, appUrl: appUrl(), formatTime });
    const result = await mailer.send({ to: { email: teacher.email, name: teacher.name }, ...message });
    if (result?.skipped) continue;
    await AuditLog.create({ action: "email_digest_sent", target: { type: "User", id: teacher._id }, note: day });
    sent += 1;
  }
  return { due: true, sent };
};

// Everything the scheduler runs, in order. Safe to run any number of times.
const runJobs = async (now = new Date()) => {
  const summary = { at: now.toISOString() };
  summary.closed = await sweepExpiredSessions();
  summary.retimed = await retimeOldSessions();
  summary.locked = await lockDueSessions();
  summary.retention = await runRetention();
  summary.digest = await sendDigests(now);
  return summary;
};
exports.runJobs = runJobs;
exports.secretMatches = secretMatches;

// POST /jobs/run (GitHub Actions cron, header x-jobs-secret).
exports.runJobsRoute = catchAsyncError(async (req, res, next) => {
  if (!process.env.JOBS_SECRET) return next(new ErrorHandler("Jobs are not configured on the server", 503));
  if (!secretMatches(req.get("x-jobs-secret"), process.env.JOBS_SECRET)) return next(new ErrorHandler("Not allowed", 401));
  res.status(200).json({ success: true, summary: await runJobs() });
});
