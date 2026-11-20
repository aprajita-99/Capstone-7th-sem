const mongoose = require("mongoose");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const CourseClass = require("../models/classModels");
const Enrollment = require("../models/enrollmentModels");
const User = require("../models/userModels");
const AttendanceSession = require("../models/attendanceSessionModels");
const AttendanceRecord = require("../models/attendanceRecordModels");
const CheckinEvidence = require("../models/checkinEvidenceModels");
const IdentityMedia = require("../models/identityMediaModels");
const AuditLog = require("../models/auditLogModels");
const faceClient = require("../utils/faceClient");
const { currentKey, findKey } = require("../utils/keys");
const { decide, faceStatusFrom } = require("../utils/attendanceDecision");
const { endOfDay, lockTimeFor } = require("../utils/clock");
const { isLocked, canQuery, lockOutcome } = require("../utils/reviewRules");
const { verifyDeviceProof } = require("../utils/deviceProof");
const { consumeFaceSession } = require("../utils/faceSessions");
const { SLOT_MS, relayPlan, studentWave } = require("../utils/relay");

const PROFILES = ["high", "mid", "low"];
const MAX_FACE_ATTEMPTS = 2;
const FACE_GRACE_MS = 2 * 60 * 1000; // face step may finish up to 2 min after the window closes

const envNumber = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const defaultSettings = () => ({
  windowMin: envNumber("CHECKIN_WINDOW_MIN", 6),
  keyLifetimeSec: envNumber("KEY_LIFETIME_SEC", 15),
  maxWaves: envNumber("MAX_WAVES", 6),
  profile: PROFILES.includes(process.env.CHECKIN_PROFILE) ? process.env.CHECKIN_PROFILE : "mid",
  faceRequired: true, // owner decision: face check at every check-in
});

// Evidence (IP, browser, check-in frame) is deleted when the check-in locks;
// the TTL is only a backstop in case the lock job does not run.
const evidenceTtlMs = () => envNumber("EVIDENCE_TTL_HOURS", 48) * 60 * 60 * 1000;

// ---------- shared helpers ----------

const countByStatus = async (sessionId) => {
  const rows = await AttendanceRecord.aggregate([
    { $match: { session: sessionId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const counts = { joined: 0, heard: 0, present: 0, review: 0, absent: 0 };
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return counts;
};

// Present students per wave: { "1": 12, "2": 5 } (wave 1 heard the teacher).
const countByWave = async (sessionId) => {
  const rows = await AttendanceRecord.aggregate([
    { $match: { session: sessionId, status: "present", "acoustic.wave": { $ne: null } } },
    { $group: { _id: "$acoustic.wave", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.sort((left, right) => left._id - right._id).map((row) => [String(row._id), row.count]));
};

const refreshStats = async (session) => {
  session.stats = { ...(await countByStatus(session._id)), byWave: await countByWave(session._id) };
  await session.save();
  return session;
};

const faceGraceEndsAt = (session) => (session.closedAt ? new Date(session.closedAt.getTime() + FACE_GRACE_MS) : null);

// The face step is open while the window is open, and for 2 minutes after it closes.
const faceStepOpen = (session, now = Date.now()) =>
  session.status === "open" || (session.status === "closed" && session.closedAt && now <= faceGraceEndsAt(session).getTime());

/**
 * Close a session exactly once: students who joined but were never heard go
 * to review (not_heard), roster students with no record become absent.
 * Students who heard the key keep their 2-minute grace for the face step.
 */
const finalizeSession = async (session) => {
  const now = new Date();
  const closing = await AttendanceSession.findOneAndUpdate(
    { _id: session._id, status: "open" },
    { $set: { status: "closed", closedAt: now } },
    { new: true }
  );
  if (!closing) return AttendanceSession.findById(session._id); // someone else closed it

  const notHeard = decide({ joined: true, heard: false });
  await AttendanceRecord.updateMany({ session: closing._id, status: "joined" }, { $set: { status: notHeard.status, reasons: notHeard.reasons } });

  const roster = await Enrollment.find({ class: closing.class, status: "active" }).select("email");
  const withRecord = new Set(await AttendanceRecord.distinct("email", { session: closing._id }));
  const absent = decide({});
  const missing = roster.filter((entry) => !withRecord.has(entry.email));
  if (missing.length > 0) {
    await AttendanceRecord.insertMany(
      missing.map((entry) => ({ session: closing._id, class: closing.class, email: entry.email, status: absent.status, reasons: absent.reasons })),
      { ordered: false }
    ).catch((error) => {
      if (error.code !== 11000 && !error.writeErrors) throw error; // a record appeared meanwhile; keep it
    });
  }

  return refreshStats(closing);
};

// Students still waiting on their face step go to review (after the grace, or at the lock).
const settleHeardRecords = async (session) => {
  const waiting = await AttendanceRecord.find({ session: session._id, status: "heard" });
  if (waiting.length === 0) return session;
  for (const record of waiting) {
    const decision = decide({ joined: true, heard: true, deviceVerified: true, faceRequired: true, face: { status: record.face?.status || "missing" }, faceFinal: true });
    record.status = decision.status;
    record.reasons = decision.reasons;
    await record.save();
  }
  return refreshStats(session);
};

const finalizeFaceGrace = async (session) => {
  if (session.status !== "closed" || faceStepOpen(session)) return session;
  return settleHeardRecords(session);
};

/**
 * Lock a closed check-in exactly once (Phase 10): undecided review cases
 * become absent (unresolved, audited as the system) and the check-in's
 * evidence (IP, browser, face frames) is deleted. Nothing changes afterwards.
 */
const lockSession = async (session) => {
  await settleHeardRecords(session);
  const now = new Date();
  const locking = await AttendanceSession.findOneAndUpdate(
    { _id: session._id, status: "closed", lockAt: { $lte: now } },
    { $set: { status: "locked", lockedAt: now } },
    { new: true }
  );
  if (!locking) return AttendanceSession.findById(session._id); // someone else locked it

  const undecided = await AttendanceRecord.find({ session: locking._id, status: "review" });
  const audits = [];
  for (const record of undecided) {
    const before = { status: record.status, reasons: [...record.reasons] };
    const outcome = lockOutcome(record);
    record.status = outcome.status;
    record.reasons = outcome.reasons;
    record.decision = { status: outcome.status, kind: "lock", from: "review", at: now };
    await record.save();
    audits.push({ action: "attendance_unresolved_absent", target: { type: "AttendanceRecord", id: record._id }, before, after: { status: record.status, reasons: record.reasons }, note: "Not decided before the lock" });
  }
  if (audits.length) await AuditLog.insertMany(audits);

  const recordIds = await AttendanceRecord.distinct("_id", { session: locking._id });
  await CheckinEvidence.deleteMany({ record: { $in: recordIds } });
  return refreshStats(locking);
};

// Bring a session up to date: close when its window ended, settle the face
// grace, lock when lockAt has passed. Runs on every read and write, so the
// lock holds even when no background job runs.
const settleSession = async (session) => {
  let current = session;
  const now = Date.now();
  if (current.status === "open" && (current.closesAt.getTime() <= now || current.lockAt.getTime() <= now)) current = await finalizeSession(current);
  current = await finalizeFaceGrace(current);
  if (current.status === "closed" && current.lockAt.getTime() <= now) current = await lockSession(current);
  return current;
};
exports.settleSession = settleSession;
exports.refreshStats = refreshStats;

/**
 * Settle a list of sessions with as few database round trips as possible.
 * Same outcome as calling settleSession on each, but sessions with nothing
 * due are returned as they are: one query finds which closed sessions still
 * have students waiting on the face step, and only the sessions that need it
 * (window ended, grace over with someone waiting, or lock due) are settled.
 */
const settleSessions = async (sessions) => {
  const now = Date.now();
  const graceOver = sessions.filter((session) => session.status === "closed" && !faceStepOpen(session, now));
  const waiting = graceOver.length
    ? new Set((await AttendanceRecord.distinct("session", { session: { $in: graceOver.map((session) => session._id) }, status: "heard" })).map(String))
    : new Set();
  const needsWork = (session) =>
    (session.status === "open" && (session.closesAt.getTime() <= now || session.lockAt.getTime() <= now)) ||
    (session.status === "closed" && (session.lockAt.getTime() <= now || waiting.has(String(session._id))));
  const settled = [];
  for (const session of sessions) settled.push(needsWork(session) ? await settleSession(session) : session);
  return settled;
};
exports.settleSessions = settleSessions;

// Locks every check-in whose lockAt has passed (jobs run + index.js interval).
exports.lockDueSessions = async () => {
  const due = await AttendanceSession.find({ status: { $in: ["open", "closed"] }, lockAt: { $lte: new Date() } });
  await settleSessions(due);
  return due.length;
};

// Closes every open session whose window has ended and settles face grace (called from index.js).
exports.sweepExpiredSessions = async () => {
  const expired = await AttendanceSession.find({ status: "open", closesAt: { $lte: new Date() } });
  for (const session of expired) await finalizeSession(session);
  const waitingSessionIds = await AttendanceRecord.distinct("session", { status: "heard" });
  const graceOver = await AttendanceSession.find({ _id: { $in: waitingSessionIds }, status: "closed", closedAt: { $lte: new Date(Date.now() - FACE_GRACE_MS) } });
  for (const session of graceOver) await finalizeFaceGrace(session);
  return expired.length;
};

const getOwnedClass = async (classId, teacherId, next) => {
  if (!mongoose.isValidObjectId(classId)) {
    next(new ErrorHandler("Class not found", 404));
    return null;
  }
  const courseClass = await CourseClass.findOne({ _id: classId, teacher: teacherId });
  if (!courseClass) next(new ErrorHandler("Class not found", 404));
  return courseClass;
};

const getOwnedSession = async (sessionId, teacherId, next) => {
  if (!mongoose.isValidObjectId(sessionId)) {
    next(new ErrorHandler("Check-in not found", 404));
    return null;
  }
  const session = await AttendanceSession.findOne({ _id: sessionId, teacher: teacherId });
  if (!session) {
    next(new ErrorHandler("Check-in not found", 404));
    return null;
  }
  return settleSession(session);
};

// Student must be on the active roster of the session's class.
const loadStudentSession = async (sessionId, user) => {
  if (!mongoose.isValidObjectId(sessionId)) return { error: new ErrorHandler("Check-in not found", 404) };
  const found = await AttendanceSession.findById(sessionId);
  if (!found) return { error: new ErrorHandler("Check-in not found", 404) };
  const onRoster = await Enrollment.exists({ class: found.class, email: user.email, status: "active" });
  if (!onRoster) return { error: new ErrorHandler("You are not on this class roster", 403) };
  return { session: await settleSession(found) };
};

const getStudentSession = async (sessionId, user, next) => {
  const { session, error } = await loadStudentSession(sessionId, user);
  if (error) next(error);
  return session || null;
};

/**
 * Teacher-facing rows for attendance records (live page, summary, Reviews):
 * roster name + roll, sound / face / relay steps, decision, student query,
 * and whether a check-in frame and an enrolled face exist.
 */
const recordViews = async (records) => {
  if (records.length === 0) return [];
  const emails = [...new Set(records.map((record) => record.email))];
  const classIds = [...new Set(records.map((record) => String(record.class)))];
  const [roster, students, framed] = await Promise.all([
    Enrollment.find({ class: { $in: classIds }, email: { $in: emails } }).select("class email name identity"),
    User.find({ email: { $in: emails } }).select("email enrollment.referenceFaceMedia"),
    CheckinEvidence.distinct("record", { record: { $in: records.map((record) => record._id) }, frame: { $exists: true } }),
  ]);
  const rosterByKey = new Map(roster.map((entry) => [`${entry.class}|${entry.email}`, entry]));
  const referenceByEmail = new Map(students.map((student) => [student.email, student.enrollment?.referenceFaceMedia || null]));
  const framedIds = new Set(framed.map(String));

  return records.map((record) => {
    const entry = rosterByKey.get(`${record.class}|${record.email}`);
    return {
      _id: record._id,
      session: record.session,
      email: record.email,
      name: entry?.name || "",
      rollNumber: entry?.identity?.rollNumber || "",
      loginId: entry?.identity?.loginId || record.email.split("@")[0],
      status: record.status,
      reasons: record.reasons,
      wave: record.acoustic?.wave,
      heardAt: record.acoustic?.heardAt,
      joinedAt: record.joinedAt,
      face: record.face?.status ? record.face : null,
      relayedAt: record.relayedAt,
      decision: record.decision?.status ? record.decision : null,
      query: record.query?.raisedAt ? record.query : null,
      hasFrame: framedIds.has(String(record._id)),
      referenceFaceMedia: referenceByEmail.get(record.email) || null,
    };
  });
};
exports.recordViews = recordViews;

const publicSession = (session) => ({
  _id: session._id,
  class: session.class,
  status: session.status,
  locked: isLocked(session),
  lockedAt: session.lockedAt,
  headcount: session.headcount?.count ?? null,
  startedAt: session.startedAt,
  closesAt: session.closesAt,
  closedAt: session.closedAt,
  faceGraceEndsAt: faceGraceEndsAt(session),
  lockAt: session.lockAt,
  settings: session.settings,
  stats: session.stats,
});

/**
 * May this student start / submit a face check for this check-in now?
 * Used by POST /face/liveness-session (purpose "checkin") and the face submit.
 * → { session, record } or { error }
 */
const checkinFaceState = async (user, sessionId) => {
  const { session, error } = await loadStudentSession(sessionId, user);
  if (error) return { error };
  if (!session.settings.faceRequired) return { error: new ErrorHandler("This check-in does not use the face check", 409) };
  if (!faceStepOpen(session)) return { error: new ErrorHandler("The face check for this check-in has closed", 409, "face_closed") };
  const record = await AttendanceRecord.findOne({ session: session._id, email: user.email });
  if (!record || record.status !== "heard") return { error: new ErrorHandler("Hear the key first", 409, "not_heard") };
  if ((record.face?.attempts || 0) >= MAX_FACE_ATTEMPTS) return { error: new ErrorHandler("No face check attempts left", 409, "face_attempts") };
  return { session, record };
};
exports.checkinFaceState = checkinFaceState;

// ---------- teacher ----------

exports.startSession = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;
  if (courseClass.archived) return next(new ErrorHandler("This class is archived. Restore it to take attendance.", 400));

  const open = await AttendanceSession.findOne({ class: courseClass._id, status: "open" });
  if (open && (await settleSession(open)).status === "open") {
    return next(new ErrorHandler("A check-in is already open for this class", 409));
  }

  const settings = defaultSettings();
  const requestedWindow = Number(req.body?.windowMin);
  if (Number.isFinite(requestedWindow) && requestedWindow > 0) settings.windowMin = Math.min(30, Math.max(1, Math.round(requestedWindow)));

  const now = new Date();
  let session;
  try {
    session = await AttendanceSession.create({
      class: courseClass._id,
      teacher: req.user._id,
      room: courseClass.defaultRoom,
      status: "open",
      startedAt: now,
      closesAt: new Date(now.getTime() + settings.windowMin * 60 * 1000),
      lockAt: lockTimeFor(now),
      settings,
    });
  } catch (error) {
    if (error.code === 11000) return next(new ErrorHandler("A check-in is already open for this class", 409));
    throw error;
  }

  await currentKey(session, 0, now);
  res.status(201).json({ success: true, session: publicSession(session) });
});

exports.listClassSessions = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;

  const sessions = await AttendanceSession.find({ class: courseClass._id }).sort({ startedAt: -1 }).limit(20);
  const current = await settleSessions(sessions);
  const open = current.find((session) => session.status === "open");
  const { profile, windowMin } = defaultSettings();
  res.status(200).json({
    success: true,
    openSession: open ? publicSession(open) : null,
    sessions: current.map(publicSession),
    defaults: { profile, windowMin }, // lets the teacher's speaker check use the session band
    faceService: faceClient.isConfigured(),
  });
});

// Teacher home "Today": running check-ins and today's finished ones across the
// teacher's active classes, in one request (instead of one request per class).
exports.teacherToday = catchAsyncError(async (req, res) => {
  const classes = await CourseClass.find({ teacher: req.user._id, archived: { $ne: true } }).select("courseCode title section");
  const startOfToday = new Date(endOfDay().getTime() + 1 - 24 * 60 * 60 * 1000);
  const sessions = await AttendanceSession.find({
    class: { $in: classes.map((courseClass) => courseClass._id) },
    $or: [{ status: "open" }, { startedAt: { $gte: startOfToday } }],
  }).sort({ startedAt: -1 });
  const settled = await settleSessions(sessions);
  const classById = new Map(classes.map((courseClass) => [String(courseClass._id), courseClass]));
  const entry = (session) => ({ class: classById.get(String(session.class)) || null, session: publicSession(session) });
  res.status(200).json({
    success: true,
    running: settled.filter((session) => session.status === "open").map(entry),
    done: settled.filter((session) => session.status !== "open" && session.startedAt >= startOfToday).map(entry),
  });
});

exports.getSession = catchAsyncError(async (req, res, next) => {
  const session = await getOwnedSession(req.params.sessionId, req.user._id, next);
  if (!session) return;

  const [records, rosterSize, courseClass, counts, byWave] = await Promise.all([
    AttendanceRecord.find({ session: session._id }).sort({ updatedAt: -1 }),
    Enrollment.countDocuments({ class: session.class, status: "active" }),
    CourseClass.findById(session.class).select("courseCode title section"),
    countByStatus(session._id),
    countByWave(session._id),
  ]);

  res.status(200).json({
    success: true,
    session: publicSession(session),
    class: courseClass,
    rosterSize,
    counts,
    byWave,
    records: await recordViews(records),
  });
});

// Teacher's head count (Phase 10): warns when more students are present than are in the room.
exports.setHeadcount = catchAsyncError(async (req, res, next) => {
  const session = await getOwnedSession(req.params.sessionId, req.user._id, next);
  if (!session) return;
  if (isLocked(session)) return next(new ErrorHandler("This check-in is locked", 409, "locked"));
  const count = Number(req.body?.headcount);
  if (!Number.isInteger(count) || count < 0 || count > 500) return next(new ErrorHandler("Head count must be a whole number from 0 to 500", 400));
  session.headcount = { count, at: new Date() };
  await session.save();
  const present = await AttendanceRecord.countDocuments({ session: session._id, status: "present" });
  res.status(200).json({ success: true, session: publicSession(session), present, warning: present > count ? `${present} marked present but you counted ${count}` : null });
});

// Spot-check (Phase 10): n random present students to call out in class.
exports.spotCheck = catchAsyncError(async (req, res, next) => {
  const session = await getOwnedSession(req.params.sessionId, req.user._id, next);
  if (!session) return;
  const size = Math.min(10, Math.max(1, Math.round(Number(req.query.n) || 5)));
  const sampled = await AttendanceRecord.aggregate([{ $match: { session: session._id, status: "present" } }, { $sample: { size } }]);
  const records = await AttendanceRecord.find({ _id: { $in: sampled.map((row) => row._id) } });
  res.status(200).json({ success: true, records: await recordViews(records), locked: isLocked(session) });
});

exports.getBeacon = catchAsyncError(async (req, res, next) => {
  const session = await getOwnedSession(req.params.sessionId, req.user._id, next);
  if (!session) return;
  if (session.status !== "open") return next(new ErrorHandler("This check-in is closed", 409));

  const key = await currentKey(session, 0);
  res.status(200).json({ success: true, value: key.value, validUntil: key.validUntil, profile: session.settings.profile, closesAt: session.closesAt });
});

exports.closeSession = catchAsyncError(async (req, res, next) => {
  const session = await getOwnedSession(req.params.sessionId, req.user._id, next);
  if (!session) return;
  const closed = session.status === "open" ? await finalizeSession(session) : session;
  res.status(200).json({ success: true, session: publicSession(closed) });
});

// Check-in face frame: the class teacher or the student themselves; deleted when the check-in locks.
exports.getEvidenceFrame = catchAsyncError(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.recordId)) return next(new ErrorHandler("Frame not found", 404));
  const record = await AttendanceRecord.findById(req.params.recordId);
  if (!record) return next(new ErrorHandler("Frame not found", 404));
  const ownRecord = record.email === req.user.email;
  const teacherOwns = req.user.role === "teacher" && (await AttendanceSession.exists({ _id: record.session, teacher: req.user._id }));
  if (!ownRecord && !teacherOwns) return next(new ErrorHandler("You cannot view this frame", 403));
  const evidence = await CheckinEvidence.findOne({ record: record._id, frame: { $exists: true } }).sort({ updatedAt: -1 });
  if (!evidence?.frame) return next(new ErrorHandler("Frame not found (frames are deleted when the check-in locks)", 404));
  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" });
  res.send(evidence.frame);
});

// ---------- student ----------

exports.listActiveSessions = catchAsyncError(async (req, res) => {
  const classIds = await Enrollment.distinct("class", { email: req.user.email, status: "active" });
  const sessions = await AttendanceSession.find({ class: { $in: classIds }, status: "open", closesAt: { $gt: new Date() } })
    .populate("class", "courseCode title section")
    .sort({ startedAt: -1 });
  const records = await AttendanceRecord.find({ session: { $in: sessions.map((session) => session._id) }, email: req.user.email }).select("session status");
  const statusBySession = new Map(records.map((record) => [record.session.toString(), record.status]));

  res.status(200).json({
    success: true,
    identityVerified: req.user.enrollment?.status === "verified",
    sessions: sessions.map((session) => ({
      _id: session._id,
      class: session.class,
      closesAt: session.closesAt,
      profile: session.settings.profile,
      faceRequired: session.settings.faceRequired,
      myStatus: statusBySession.get(session._id.toString()) || null,
    })),
  });
});

exports.joinSession = catchAsyncError(async (req, res, next) => {
  const session = await getStudentSession(req.params.sessionId, req.user, next);
  if (!session) return;
  if (session.status !== "open") return next(new ErrorHandler("This check-in is closed", 409));
  if (session.settings.faceRequired && req.user.enrollment?.status !== "verified") {
    return next(new ErrorHandler("Complete your identity check before joining check-ins", 403, "not_enrolled"));
  }

  const record = await AttendanceRecord.findOneAndUpdate(
    { session: session._id, email: req.user.email },
    {
      $setOnInsert: { session: session._id, class: session.class, email: req.user.email, status: "joined", joinedAt: new Date() },
      $set: { student: req.user._id },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  res.status(200).json({
    success: true,
    record: { status: record.status, face: record.face?.status ? record.face : null, relayed: Boolean(record.relayedAt) },
    session: { _id: session._id, closesAt: session.closesAt, profile: session.settings.profile, faceRequired: session.settings.faceRequired },
  });
});

const relayFor = async (session, keyWave) => {
  // Planned now (after any database work) so the lead time is not used up.
  const plan = relayPlan({ keyWave, maxWaves: session.settings.maxWaves || 5, now: Date.now() });
  if (!plan) return null;
  const relayKey = await currentKey(session, plan.wave);
  return { wave: plan.wave, value: relayKey.value, profile: session.settings.profile, playAt: plan.playAt, slotMs: SLOT_MS };
};

exports.claimKey = catchAsyncError(async (req, res, next) => {
  const session = await getStudentSession(req.params.sessionId, req.user, next);
  if (!session) return;
  if (session.status !== "open") return next(new ErrorHandler("This check-in is closed", 409));

  const key = Number(req.body?.key);
  if (!Number.isInteger(key)) return next(new ErrorHandler("A heard key is required", 400));

  // The signed payload binds the key to this session and this phone.
  const proof = await verifyDeviceProof({
    user: req.user,
    challengeId: req.body.challengeId,
    signature: req.body.signature,
    purpose: "claim",
    payload: { sessionId: session._id.toString(), key },
  });
  if (!proof.ok) return next(new ErrorHandler(proof.reason, 401));

  const issued = await findKey(session, key);
  if (!issued) return next(new ErrorHandler("That key is not valid for this check-in", 400));

  const existing = await AttendanceRecord.findOne({ session: session._id, email: req.user.email });
  if (existing?.acoustic?.heard) {
    // Already heard: the phone continues with its face step / relay.
    return res.status(200).json({ success: true, status: existing.status, alreadyHeard: true, alreadyPresent: existing.status === "present", wave: existing.acoustic.wave });
  }
  if (session.settings.faceRequired && req.user.enrollment?.status !== "verified") {
    return next(new ErrorHandler("Complete your identity check before joining check-ins", 403, "not_enrolled"));
  }

  const now = new Date();
  const wave = studentWave(issued.wave); // heard the teacher (key wave 0) → wave 1
  const decision = decide({ joined: true, heard: true, deviceVerified: true, faceRequired: session.settings.faceRequired });
  const record = await AttendanceRecord.findOneAndUpdate(
    { session: session._id, email: req.user.email },
    {
      $set: {
        student: req.user._id,
        status: decision.status,
        reasons: decision.reasons,
        acoustic: { heard: true, wave, heardAt: now },
        device: { fingerprint: req.user.deviceBinding?.fingerprint, verified: true },
      },
      $setOnInsert: { session: session._id, class: session.class, email: req.user.email, joinedAt: now },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await CheckinEvidence.create({
    record: record._id,
    ip: req.ip,
    userAgent: String(req.get("user-agent") || "").slice(0, 300),
    expiresAt: new Date(now.getTime() + evidenceTtlMs()),
  });

  // Sound-only check-ins relay straight away; with the face check the phone
  // asks for its relay after the face step (POST /sessions/:id/relay).
  let relay = null;
  if (!session.settings.faceRequired) {
    relay = await relayFor(session, issued.wave);
    if (relay) await AttendanceRecord.updateOne({ _id: record._id }, { $set: { relayedAt: new Date() } });
  }

  res.status(200).json({ success: true, status: record.status, wave, faceRequired: session.settings.faceRequired, relay });
});

// Live face (AWS liveness) compared with the student's reference face; signed by the bound phone.
exports.submitFace = catchAsyncError(async (req, res, next) => {
  if (!faceClient.isConfigured()) return next(new ErrorHandler("Face checks are not configured on the server", 503));
  const { session, record, error } = await checkinFaceState(req.user, req.params.sessionId);
  if (error) return next(error);

  const { livenessSessionId, challengeId, signature } = req.body || {};
  const proof = await verifyDeviceProof({ user: req.user, challengeId, signature, purpose: "face", payload: { livenessSessionId: String(livenessSessionId || "") } });
  if (!proof.ok) return next(new ErrorHandler(proof.reason, 401));

  const faceSession = await consumeFaceSession({ awsSessionId: livenessSessionId, user: req.user, purpose: "checkin" });
  if (!faceSession || String(faceSession.session) !== String(session._id)) {
    return next(new ErrorHandler("Face check expired or already used, please start again", 404));
  }

  const liveness = await faceClient.getLivenessResult(faceSession.awsSessionId);
  const reference = req.user.enrollment?.referenceFaceMedia ? await IdentityMedia.findById(req.user.enrollment.referenceFaceMedia) : null;
  const comparison = liveness.verdict === "live" && liveness.referenceImage && reference
    ? await faceClient.compareFaces(reference.data, liveness.referenceImage)
    : { similarity: 0, decision: "no_match" };

  const faceStatus = faceStatusFrom(liveness.verdict, comparison.decision);
  const attempts = (record.face?.attempts || 0) + 1;
  const retryAllowed = ["unsure", "not_live"].includes(faceStatus) && attempts < MAX_FACE_ATTEMPTS;
  const decision = decide({ joined: true, heard: true, deviceVerified: true, faceRequired: true, face: { status: faceStatus }, faceFinal: !retryAllowed });

  record.face = { status: faceStatus, similarity: comparison.similarity, liveness: liveness.confidence, attempts, checkedAt: new Date() };
  record.status = decision.status;
  record.reasons = decision.reasons;
  await record.save();

  if (liveness.referenceImage) {
    const updated = await CheckinEvidence.findOneAndUpdate({ record: record._id }, { $set: { frame: liveness.referenceImage } }, { sort: { createdAt: -1 } });
    if (!updated) {
      await CheckinEvidence.create({ record: record._id, frame: liveness.referenceImage, expiresAt: new Date(Date.now() + evidenceTtlMs()) });
    }
  }

  res.status(200).json({
    success: true,
    face: { status: faceStatus, retryAllowed, attempts, maxAttempts: MAX_FACE_ATTEMPTS },
    record: { status: record.status, reasons: record.reasons },
  });
});

// Student gives up the remaining face attempt: settle the record now (review).
exports.skipFace = catchAsyncError(async (req, res, next) => {
  const { session, error } = await loadStudentSession(req.params.sessionId, req.user);
  if (error) return next(error);
  const record = await AttendanceRecord.findOne({ session: session._id, email: req.user.email });
  if (!record || record.status !== "heard") return next(new ErrorHandler("Nothing to skip", 409));
  const decision = decide({ joined: true, heard: true, deviceVerified: true, faceRequired: true, face: { status: record.face?.status || "missing" }, faceFinal: true });
  record.status = decision.status;
  record.reasons = decision.reasons;
  await record.save();
  res.status(200).json({ success: true, record: { status: record.status, reasons: record.reasons } });
});

// After the face step: the phone relays the next wave's key once (only while the check-in is open).
exports.requestRelay = catchAsyncError(async (req, res, next) => {
  const session = await getStudentSession(req.params.sessionId, req.user, next);
  if (!session) return;
  const record = await AttendanceRecord.findOne({ session: session._id, email: req.user.email });
  if (!record?.acoustic?.heard) return next(new ErrorHandler("Hear the key first", 409, "not_heard"));
  if (session.status !== "open") return res.status(200).json({ success: true, relay: null, reason: "closed" });

  const claimed = await AttendanceRecord.findOneAndUpdate({ _id: record._id, relayedAt: null }, { $set: { relayedAt: new Date() } }, { new: true });
  if (!claimed) return res.status(200).json({ success: true, relay: null, reason: "already_relayed" });

  const relay = await relayFor(session, (record.acoustic.wave || 1) - 1);
  res.status(200).json({ success: true, relay, reason: relay ? undefined : "last_wave" });
});

// What a student sees of a decision and of their own query (never the teacher's note).
const studentDecision = (decision) => (decision?.status ? { status: decision.status, kind: decision.kind || (decision.by ? "review" : null), at: decision.at } : null);
const studentQuery = (query) => (query?.raisedAt ? { reason: query.reason, text: query.text, raisedAt: query.raisedAt } : null);
exports.studentDecision = studentDecision;
exports.studentQuery = studentQuery;

exports.getMyRecord = catchAsyncError(async (req, res, next) => {
  const session = await getStudentSession(req.params.sessionId, req.user, next);
  if (!session) return;
  const record = await AttendanceRecord.findOne({ session: session._id, email: req.user.email }).select("status reasons acoustic face relayedAt decision query");
  await session.populate("class", "courseCode title section");
  res.status(200).json({
    success: true,
    session: {
      _id: session._id,
      status: session.status,
      closesAt: session.closesAt,
      closedAt: session.closedAt,
      faceGraceEndsAt: faceGraceEndsAt(session),
      lockAt: session.lockAt,
      locked: isLocked(session),
      profile: session.settings.profile,
      faceRequired: session.settings.faceRequired,
      class: session.class,
    },
    identityVerified: req.user.enrollment?.status === "verified",
    record: record
      ? {
          _id: record._id,
          status: record.status,
          reasons: record.reasons,
          heardAt: record.acoustic?.heardAt,
          face: record.face?.status ? record.face : null,
          relayed: Boolean(record.relayedAt),
          decision: studentDecision(record.decision),
          query: studentQuery(record.query),
          canQuery: canQuery(record, session).ok,
        }
      : null,
  });
});
