const mongoose = require("mongoose");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const CourseClass = require("../models/classModels");
const Enrollment = require("../models/enrollmentModels");
const AttendanceSession = require("../models/attendanceSessionModels");
const AttendanceRecord = require("../models/attendanceRecordModels");
const { startOfWeek } = require("../utils/clock");
const { canQuery, isLocked } = require("../utils/reviewRules");
const report = require("../utils/attendanceReport");
const { settleSession, settleSessions, studentDecision, studentQuery } = require("./sessionController");

// Plain words for reasons in CSV exports (same meaning as the teacher UI labels).
const REASON_WORDS = {
  not_heard: "Not heard",
  face_mismatch: "Face doesn't match",
  face_unsure: "Face unsure",
  face_not_live: "Not a live face",
  face_missing: "No face check",
  device_unverified: "Phone not verified",
  not_joined: "Did not join",
  student_query: "Student query",
  unresolved: "Not decided before the lock",
};
const STATUS_WORDS = { present: "Present", absent: "Absent", review: "Review", heard: "Face check pending", joined: "Listening" };
const FACE_WORDS = { passed: "Matched", unsure: "Unsure", mismatch: "Mismatch", not_live: "Not live", missing: "Missing" };

// Every check-in of these classes, brought up to date (close / face grace / lock) first.
const settledSessions = async (filter) => {
  const sessions = await AttendanceSession.find(filter).sort({ startedAt: 1 });
  return settleSessions(sessions);
};

const isCounted = (session) => report.COUNTED_SESSION_STATUSES.includes(session.status);

const loadOwnedClass = async (classId, teacherId) => {
  if (!mongoose.isValidObjectId(classId)) return null;
  return CourseClass.findOne({ _id: classId, teacher: teacherId });
};

// The class matrix: counted check-ins × every student who was ever on the roster.
const classReport = async (courseClass) => {
  const sessions = await settledSessions({ class: courseClass._id });
  const counted = sessions.filter(isCounted);
  const [roster, records] = await Promise.all([
    Enrollment.find({ class: courseClass._id }).select("email name identity status"),
    AttendanceRecord.find({ session: { $in: counted.map((session) => session._id) } }).select("session email status"),
  ]);
  return { sessions, counted, matrix: report.buildClassMatrix({ sessions: counted, roster, records }) };
};

// ---------- teacher ----------

// GET /classes/:classId/attendance
exports.classAttendance = catchAsyncError(async (req, res, next) => {
  const courseClass = await loadOwnedClass(req.params.classId, req.user._id);
  if (!courseClass) return next(new ErrorHandler("Class not found", 404));
  const { sessions, counted, matrix } = await classReport(courseClass);
  const open = sessions.find((session) => session.status === "open");
  res.status(200).json({
    success: true,
    class: { _id: courseClass._id, courseCode: courseClass.courseCode, title: courseClass.title, section: courseClass.section, archived: courseClass.archived },
    minPercent: report.MIN_PERCENT,
    sessions: counted.map((session) => ({ _id: session._id, startedAt: session.startedAt, status: session.status, locked: isLocked(session), stats: session.stats })),
    openSession: open ? { _id: open._id, startedAt: open.startedAt } : null,
    students: matrix.students,
    removed: matrix.removed,
    summary: matrix.summary,
  });
});

const sendCsv = (res, fileName, rows) => {
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, no-store",
  });
  res.send(report.toCsv(rows));
};

// GET /classes/:classId/attendance.csv: one row per student, one column per check-in.
exports.classAttendanceCsv = catchAsyncError(async (req, res, next) => {
  const courseClass = await loadOwnedClass(req.params.classId, req.user._id);
  if (!courseClass) return next(new ErrorHandler("Class not found", 404));
  const { counted, matrix } = await classReport(courseClass);
  const header = ["Roll", "Name", "Email", "Removed", ...counted.map((session) => report.formatIst(session.startedAt)), "Present", "Counted", "Pending", "Percent"];
  const row = (student) => [
    student.loginId,
    student.name,
    student.email,
    student.current ? "" : "removed",
    ...student.cells.map((cell) => (cell.status === "-" ? "" : cell.status)),
    student.present,
    student.counted,
    student.pending,
    student.percent === null ? "" : student.percent,
  ];
  sendCsv(res, report.csvFileName(courseClass, "attendance"), [header, ...matrix.students.map(row), ...matrix.removed.map(row)]);
});

// GET /sessions/:sessionId/export.csv: every record of one check-in, in detail (no IP, no images).
exports.sessionCsv = catchAsyncError(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.sessionId)) return next(new ErrorHandler("Check-in not found", 404));
  const found = await AttendanceSession.findOne({ _id: req.params.sessionId, teacher: req.user._id });
  if (!found) return next(new ErrorHandler("Check-in not found", 404));
  const session = await settleSession(found);
  const [courseClass, records, roster] = await Promise.all([
    CourseClass.findById(session.class).select("courseCode section"),
    AttendanceRecord.find({ session: session._id }),
    Enrollment.find({ class: session.class }).select("email name identity"),
  ]);
  const byEmail = new Map(roster.map((entry) => [entry.email, entry]));
  const sorted = [...records].sort((left, right) => left.email.localeCompare(right.email));
  const header = ["Roll", "Name", "Email", "Status", "Reasons", "Wave", "Face", "Similarity", "Heard at", "Decision", "Decided by", "Decided at", "Query"];
  const rows = sorted.map((record) => {
    const entry = byEmail.get(record.email);
    const decision = record.decision?.status ? record.decision : null;
    return [
      entry?.identity?.loginId || record.email.split("@")[0],
      entry?.name || "",
      record.email,
      STATUS_WORDS[record.status] || record.status,
      (record.reasons || []).map((reason) => REASON_WORDS[reason] || reason).join("; "),
      record.acoustic?.wave ?? "",
      record.face?.status ? FACE_WORDS[record.face.status] || record.face.status : "",
      typeof record.face?.similarity === "number" ? Math.round(record.face.similarity) : "",
      report.formatIst(record.acoustic?.heardAt),
      decision ? `${decision.kind || "review"}: ${decision.status}` : "",
      decision ? (decision.kind === "lock" ? "system" : decision.by ? "teacher" : "") : "",
      report.formatIst(decision?.at),
      record.query?.reason || "",
    ];
  });
  sendCsv(res, report.csvFileName(courseClass, "checkin", session.startedAt), [header, ...rows]);
});

// GET /reports/summary → dashboard cards (non-archived classes only).
exports.teacherSummary = catchAsyncError(async (req, res) => {
  const classes = await CourseClass.find({ teacher: req.user._id, archived: { $ne: true } });
  const checkinsThisWeek = await AttendanceSession.countDocuments({ class: { $in: classes.map((courseClass) => courseClass._id) }, startedAt: { $gte: startOfWeek() } });
  let count = 0;
  let worst = null;
  for (const courseClass of classes) {
    const { matrix } = await classReport(courseClass);
    count += matrix.summary.below;
    if (matrix.summary.below > 0 && (!worst || matrix.summary.below > worst.below)) worst = { classId: courseClass._id, below: matrix.summary.below };
  }
  res.status(200).json({ success: true, minPercent: report.MIN_PERCENT, checkinsThisWeek, belowMin: { count, worstClassId: worst?.classId || null } });
});

// ---------- student ----------

// GET /me/attendance → per class: %, what to do to stay at 75%, and every check-in.
exports.myAttendance = catchAsyncError(async (req, res) => {
  const email = req.user.email;
  const [enrollments, recordClassIds] = await Promise.all([
    Enrollment.find({ email }).select("class status"),
    AttendanceRecord.distinct("class", { email }),
  ]);
  const activeIn = new Set(enrollments.filter((entry) => entry.status === "active").map((entry) => String(entry.class)));
  const classIds = [...new Set([...enrollments.map((entry) => String(entry.class)), ...recordClassIds.map(String)])];
  // All classes at once: one query for the classes and their check-ins, one for the student's records.
  const [classes, allSessions] = await Promise.all([
    CourseClass.find({ _id: { $in: classIds } }).select("courseCode title section archived").sort({ courseCode: 1 }),
    settledSessions({ class: { $in: classIds } }),
  ]);
  const allRecords = await AttendanceRecord.find({ session: { $in: allSessions.map((session) => session._id) }, email });
  const recordBySession = new Map(allRecords.map((record) => [String(record.session), record]));

  const result = [];
  for (const courseClass of classes) {
    const onRoster = activeIn.has(String(courseClass._id));
    const sessions = allSessions.filter((session) => String(session.class) === String(courseClass._id));
    const records = sessions.map((session) => recordBySession.get(String(session._id))).filter(Boolean);
    const counted = sessions.filter(isCounted);
    const cells = counted.map((session) => report.cellStatus(recordBySession.get(String(session._id)), { current: onRoster }));
    const summary = report.summarise(cells);
    if (!onRoster && records.length === 0) continue; // never took part and no longer on the roster

    const checkins = sessions
      .map((session) => {
        const record = recordBySession.get(String(session._id));
        if (!record && (!onRoster || session.status === "open")) return null;
        return {
          sessionId: session._id,
          recordId: record?._id || null,
          startedAt: session.startedAt,
          sessionStatus: session.status,
          locked: isLocked(session),
          lockAt: session.lockAt,
          counted: isCounted(session),
          status: record?.status || "absent",
          reasons: record ? record.reasons : ["not_on_roster"],
          decision: studentDecision(record?.decision),
          query: studentQuery(record?.query),
          canQuery: record ? canQuery(record, session).ok : false,
        };
      })
      .filter(Boolean)
      .reverse();

    result.push({
      class: { _id: courseClass._id, courseCode: courseClass.courseCode, title: courseClass.title, section: courseClass.section },
      current: onRoster && !courseClass.archived,
      archived: Boolean(courseClass.archived),
      summary,
      canMiss: report.canMiss(summary.present, summary.counted),
      needed: report.neededFor(summary.present, summary.counted),
      checkins,
    });
  }
  res.status(200).json({ success: true, minPercent: report.MIN_PERCENT, classes: result });
});
