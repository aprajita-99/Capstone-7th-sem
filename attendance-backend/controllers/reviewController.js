const mongoose = require("mongoose");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const CourseClass = require("../models/classModels");
const Enrollment = require("../models/enrollmentModels");
const User = require("../models/userModels");
const AttendanceSession = require("../models/attendanceSessionModels");
const AttendanceRecord = require("../models/attendanceRecordModels");
const DeviceBindingRequest = require("../models/deviceBindingRequestModels");
const AuditLog = require("../models/auditLogModels");
const { MAX_ATTEMPTS } = require("../utils/enrollment");
const { reviewableStudentEmails } = require("../utils/teacherAccess");
const { canDecide, canQuery, cleanQuery, isLocked } = require("../utils/reviewRules");
const { settleSession, settleSessions, refreshStats, recordViews, studentDecision, studentQuery } = require("./sessionController");

const MAX_BULK = 100;

const DECIDE_ERRORS = {
  bad_status: "Choose present or absent",
  locked: "This check-in is locked; nothing can change after 09:00 the next morning",
  in_progress: "This student is still checking in",
  same_status: "The record already has that status",
  note_required: "Add a note saying why you are changing this record",
};

// Unlocked check-ins of this teacher (settled first, so ones due to lock lock now).
const unlockedSessions = async (teacherId) => {
  const candidates = await AttendanceSession.find({ teacher: teacherId, status: { $in: ["open", "closed"] } }).sort({ startedAt: 1 });
  return (await settleSessions(candidates)).filter((session) => !isLocked(session));
};

// ---------- teacher ----------

// GET /reviews?type=attendance → review records of unlocked check-ins, grouped by check-in, oldest first.
exports.listAttendanceReviews = catchAsyncError(async (req, res) => {
  const sessions = await unlockedSessions(req.user._id);
  const [records, classes] = await Promise.all([
    AttendanceRecord.find({ session: { $in: sessions.map((session) => session._id) }, status: "review" }).sort({ updatedAt: 1 }),
    CourseClass.find({ _id: { $in: sessions.map((session) => session.class) } }).select("courseCode title section"),
  ]);
  const classById = new Map(classes.map((courseClass) => [String(courseClass._id), courseClass]));
  const views = await recordViews(records);

  const groups = sessions
    .map((session) => ({
      session: { _id: session._id, status: session.status, startedAt: session.startedAt, closedAt: session.closedAt, lockAt: session.lockAt },
      class: classById.get(String(session.class)) || null,
      records: views.filter((view) => String(view.session) === String(session._id)),
    }))
    .filter((group) => group.records.length > 0);
  res.status(200).json({ success: true, groups });
});

// GET /reviews/counts → badge numbers for the nav and the dashboard.
exports.reviewCounts = catchAsyncError(async (req, res) => {
  // Independent lookups run side by side: each sequential step costs a full database round trip.
  const [sessions, emails] = await Promise.all([unlockedSessions(req.user._id), reviewableStudentEmails(req.user._id)]);
  const sessionIds = sessions.map((session) => session._id);
  const [attendance, queries, enrollments, blocked, students] = await Promise.all([
    AttendanceRecord.countDocuments({ session: { $in: sessionIds }, status: "review" }),
    AttendanceRecord.countDocuments({ session: { $in: sessionIds }, status: "review", "query.raisedAt": { $exists: true } }),
    User.countDocuments({ email: { $in: emails }, role: "student", "enrollment.status": "pending" }),
    User.countDocuments({ email: { $in: emails }, role: "student", "enrollment.status": { $in: ["none", "rejected"] }, "enrollment.attempts": { $gte: MAX_ATTEMPTS } }),
    User.find({ email: { $in: emails }, role: "student" }).select("_id"),
  ]);
  const devices = await DeviceBindingRequest.countDocuments({ student: { $in: students.map((student) => student._id) }, status: "pending" });
  const identity = enrollments + blocked;
  res.status(200).json({ success: true, counts: { attendance, queries, enrollments: identity, devices, total: attendance + identity + devices } });
});

// Loads a record of one of the teacher's check-ins, with its session settled (may lock it now).
const loadOwnedRecord = async (recordId, teacherId) => {
  if (!mongoose.isValidObjectId(recordId)) return {};
  const record = await AttendanceRecord.findById(recordId);
  if (!record) return {};
  const found = await AttendanceSession.findOne({ _id: record.session, teacher: teacherId });
  if (!found) return {};
  const session = await settleSession(found);
  return { record: await AttendanceRecord.findById(recordId), session };
};

// Apply one teacher decision (already allowed by canDecide) and audit it with before / after.
const applyDecision = async ({ record, status, kind, note, teacherId }) => {
  const before = { status: record.status, reasons: [...record.reasons] };
  record.decision = { status, kind, from: record.status, by: teacherId, at: new Date(), note: note || undefined };
  record.status = status;
  await record.save();
  await AuditLog.create({
    actor: teacherId,
    action: kind === "override" ? "attendance_override" : `attendance_marked_${status}`,
    target: { type: "AttendanceRecord", id: record._id },
    before,
    after: { status, kind },
    note: [record.reasons.join(","), note].filter(Boolean).join(" | ") || undefined,
  });
};

// POST /records/:recordId/decision {status, note?}: decide a review case, or override present ↔ absent (note required).
exports.decideRecord = catchAsyncError(async (req, res, next) => {
  const status = req.body?.status;
  const note = String(req.body?.note || "").trim().slice(0, 300);
  const { record, session } = await loadOwnedRecord(req.params.recordId, req.user._id);
  if (!record) return next(new ErrorHandler("Record not found", 404));

  const allowed = canDecide(record, session, status, note);
  if (!allowed.ok) return next(new ErrorHandler(DECIDE_ERRORS[allowed.code], allowed.http, allowed.code));

  await applyDecision({ record, status, kind: allowed.kind, note, teacherId: req.user._id });
  await refreshStats(session);
  res.status(200).json({ success: true, record: { _id: record._id, status: record.status, decision: record.decision } });
});

// POST /records/bulk-decision {recordIds[], status:"present"}: review cases only; anything else is skipped.
exports.bulkDecide = catchAsyncError(async (req, res, next) => {
  const ids = Array.isArray(req.body?.recordIds) ? [...new Set(req.body.recordIds.map(String))] : [];
  if (req.body?.status !== "present") return next(new ErrorHandler("Bulk decisions can only mark students present", 400));
  if (ids.length === 0 || ids.length > MAX_BULK) return next(new ErrorHandler(`Choose 1 to ${MAX_BULK} students`, 400));

  const updated = [];
  const skipped = [];
  const touched = new Map();
  for (const id of ids) {
    const { record, session } = await loadOwnedRecord(id, req.user._id);
    const allowed = record && record.status === "review" ? canDecide(record, session, "present") : { ok: false };
    if (!allowed.ok) {
      skipped.push(id);
      continue;
    }
    await applyDecision({ record, status: "present", kind: allowed.kind, note: "", teacherId: req.user._id });
    updated.push(id);
    touched.set(String(session._id), session);
  }
  for (const session of touched.values()) await refreshStats(session);
  res.status(200).json({ success: true, updated, skipped });
});

// ---------- student ----------

const QUERY_ERRORS = {
  no_record: "No attendance record for this check-in",
  locked: "This check-in is locked; queries close at 09:00 the next morning",
  already_queried: "You already raised a query for this check-in",
  not_queryable: "Only absent or in-review check-ins can be queried",
  teacher_decided: "Your teacher has already decided this check-in",
};

// POST /records/:recordId/query {reason, text}: own absent / review record, once, until the lock.
// Not device-signed on purpose: a query only sends the case to the teacher and never grants attendance.
exports.raiseQuery = catchAsyncError(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.recordId)) return next(new ErrorHandler("Record not found", 404));
  const found = await AttendanceRecord.findById(req.params.recordId);
  if (!found || found.email !== req.user.email) return next(new ErrorHandler("Record not found", 404));
  const session = await settleSession(await AttendanceSession.findById(found.session));
  const record = await AttendanceRecord.findById(found._id);

  const cleaned = cleanQuery(req.body || {});
  if (cleaned.error) return next(new ErrorHandler(cleaned.error, 400));
  const allowed = canQuery(record, session);
  if (!allowed.ok) return next(new ErrorHandler(QUERY_ERRORS[allowed.code], 409, allowed.code));

  const before = { status: record.status, reasons: [...record.reasons] };
  record.query = { reason: cleaned.reason, text: cleaned.text || undefined, raisedAt: new Date(), fromStatus: record.status };
  record.status = "review";
  record.reasons = [...new Set([...record.reasons, "student_query"])];
  await record.save();
  await AuditLog.create({ actor: req.user._id, action: "attendance_query", target: { type: "AttendanceRecord", id: record._id }, before, after: { status: record.status, reasons: record.reasons }, note: cleaned.reason });
  await refreshStats(session);

  res.status(200).json({ success: true, record: { _id: record._id, status: record.status, reasons: record.reasons, query: studentQuery(record.query), canQuery: false } });
});

// GET /me/recent-checkins → the student's records from check-ins that are not locked yet.
exports.recentCheckins = catchAsyncError(async (req, res) => {
  const classIds = await Enrollment.distinct("class", { email: req.user.email, status: "active" });
  const candidates = await AttendanceSession.find({ class: { $in: classIds }, status: { $in: ["open", "closed"] } }).sort({ startedAt: -1 }).limit(20);
  const unlocked = (await settleSessions(candidates)).filter((session) => !isLocked(session));
  const [records, classes] = await Promise.all([
    AttendanceRecord.find({ session: { $in: unlocked.map((session) => session._id) }, email: req.user.email }),
    CourseClass.find({ _id: { $in: unlocked.map((session) => session.class) } }).select("courseCode title section"),
  ]);
  const recordBySession = new Map(records.map((record) => [String(record.session), record]));
  const classById = new Map(classes.map((courseClass) => [String(courseClass._id), courseClass]));

  res.status(200).json({
    success: true,
    checkins: unlocked
      .filter((session) => recordBySession.has(String(session._id)))
      .map((session) => {
        const record = recordBySession.get(String(session._id));
        return {
          recordId: record._id,
          sessionId: session._id,
          class: classById.get(String(session.class)) || null,
          sessionStatus: session.status,
          startedAt: session.startedAt,
          lockAt: session.lockAt,
          status: record.status,
          reasons: record.reasons,
          decision: studentDecision(record.decision),
          query: studentQuery(record.query),
          canQuery: canQuery(record, session).ok,
        };
      }),
  });
});
