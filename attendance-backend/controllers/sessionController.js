const mongoose = require("mongoose");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const CourseClass = require("../models/classModels");
const Enrollment = require("../models/enrollmentModels");
const AttendanceSession = require("../models/attendanceSessionModels");
const AttendanceRecord = require("../models/attendanceRecordModels");
const CheckinEvidence = require("../models/checkinEvidenceModels");
const { currentKey, findKey } = require("../utils/keys");
const { decide } = require("../utils/attendanceDecision");
const { endOfDay } = require("../utils/clock");
const { verifyDeviceProof } = require("../utils/deviceProof");
const { SLOT_MS, relayPlan, studentWave } = require("../utils/relay");

const PROFILES = ["high", "mid"];

const envNumber = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const defaultSettings = () => ({
  windowMin: envNumber("CHECKIN_WINDOW_MIN", 6),
  keyLifetimeSec: envNumber("KEY_LIFETIME_SEC", 15),
  maxWaves: envNumber("MAX_WAVES", 5),
  profile: PROFILES.includes(process.env.CHECKIN_PROFILE) ? process.env.CHECKIN_PROFILE : "mid",
  faceRequired: false,
});

const evidenceTtlMs = () => envNumber("EVIDENCE_TTL_HOURS", 24) * 60 * 60 * 1000;

// ---------- shared helpers ----------

const countByStatus = async (sessionId) => {
  const rows = await AttendanceRecord.aggregate([
    { $match: { session: sessionId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const counts = { joined: 0, present: 0, review: 0, absent: 0 };
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return counts;
};

/**
 * Close a session exactly once: students who joined but were never heard go
 * to review (not_heard), roster students with no record become absent.
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

  const stats = await countByStatus(closing._id);
  closing.stats = { ...stats, byWave: await countByWave(closing._id) };
  await closing.save();
  return closing;
};

// Present students per wave: { "1": 12, "2": 5 } (wave 1 heard the teacher).
const countByWave = async (sessionId) => {
  const rows = await AttendanceRecord.aggregate([
    { $match: { session: sessionId, status: "present", "acoustic.wave": { $ne: null } } },
    { $group: { _id: "$acoustic.wave", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.sort((left, right) => left._id - right._id).map((row) => [String(row._id), row.count]));
};

const closeIfExpired = async (session) => {
  if (session.status === "open" && session.closesAt.getTime() <= Date.now()) return finalizeSession(session);
  return session;
};

// Closes every open session whose window has ended (called from index.js).
exports.sweepExpiredSessions = async () => {
  const expired = await AttendanceSession.find({ status: "open", closesAt: { $lte: new Date() } });
  for (const session of expired) await finalizeSession(session);
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
  return closeIfExpired(session);
};

// Student must be on the active roster of the session's class.
const getStudentSession = async (sessionId, user, next) => {
  if (!mongoose.isValidObjectId(sessionId)) {
    next(new ErrorHandler("Check-in not found", 404));
    return null;
  }
  const found = await AttendanceSession.findById(sessionId);
  if (!found) {
    next(new ErrorHandler("Check-in not found", 404));
    return null;
  }
  const onRoster = await Enrollment.exists({ class: found.class, email: user.email, status: "active" });
  if (!onRoster) {
    next(new ErrorHandler("You are not on this class roster", 403));
    return null;
  }
  return closeIfExpired(found);
};

const publicSession = (session) => ({
  _id: session._id,
  class: session.class,
  status: session.status,
  startedAt: session.startedAt,
  closesAt: session.closesAt,
  closedAt: session.closedAt,
  settings: session.settings,
  stats: session.stats,
});

// ---------- teacher ----------

exports.startSession = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;
  if (courseClass.archived) return next(new ErrorHandler("This class is archived. Restore it to take attendance.", 400));

  const open = await AttendanceSession.findOne({ class: courseClass._id, status: "open" });
  if (open && (await closeIfExpired(open)).status === "open") {
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
      lockAt: endOfDay(now),
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
  const current = [];
  for (const session of sessions) current.push(await closeIfExpired(session));
  const open = current.find((session) => session.status === "open");
  const { profile, windowMin } = defaultSettings();
  res.status(200).json({
    success: true,
    openSession: open ? publicSession(open) : null,
    sessions: current.map(publicSession),
    defaults: { profile, windowMin }, // lets the teacher's speaker check use the session band
  });
});

exports.getSession = catchAsyncError(async (req, res, next) => {
  const session = await getOwnedSession(req.params.sessionId, req.user._id, next);
  if (!session) return;

  const [records, roster] = await Promise.all([
    AttendanceRecord.find({ session: session._id }).select("email status reasons joinedAt acoustic").sort({ updatedAt: -1 }),
    Enrollment.find({ class: session.class, status: "active" }).select("email name identity"),
  ]);
  const names = new Map(roster.map((entry) => [entry.email, entry]));
  const [counts, byWave] = await Promise.all([countByStatus(session._id), countByWave(session._id)]);

  res.status(200).json({
    success: true,
    session: publicSession(session),
    rosterSize: roster.length,
    counts,
    byWave,
    records: records.map((record) => ({
      email: record.email,
      name: names.get(record.email)?.name || "",
      rollNumber: names.get(record.email)?.identity?.rollNumber || "",
      status: record.status,
      reasons: record.reasons,
      wave: record.acoustic?.wave,
      heardAt: record.acoustic?.heardAt,
      joinedAt: record.joinedAt,
    })),
  });
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
    sessions: sessions.map((session) => ({
      _id: session._id,
      class: session.class,
      closesAt: session.closesAt,
      profile: session.settings.profile,
      myStatus: statusBySession.get(session._id.toString()) || null,
    })),
  });
});

exports.joinSession = catchAsyncError(async (req, res, next) => {
  const session = await getStudentSession(req.params.sessionId, req.user, next);
  if (!session) return;
  if (session.status !== "open") return next(new ErrorHandler("This check-in is closed", 409));

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
    record: { status: record.status },
    session: { _id: session._id, closesAt: session.closesAt, profile: session.settings.profile },
  });
});

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
  if (existing?.status === "present") {
    return res.status(200).json({ success: true, status: "present", alreadyPresent: true });
  }

  const now = new Date();
  const wave = studentWave(issued.wave); // heard the teacher (key wave 0) → wave 1
  const decision = decide({ joined: true, heard: true, deviceVerified: true });
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

  // Cascade: a newly present phone relays the next wave's key once, at shared slots.
  // Planned after the writes so the database time does not eat the lead time.
  const plan = relayPlan({ keyWave: issued.wave, maxWaves: session.settings.maxWaves || 5, now: Date.now() });
  let relay = null;
  if (plan) {
    const relayKey = await currentKey(session, plan.wave);
    relay = { wave: plan.wave, value: relayKey.value, profile: session.settings.profile, playAt: plan.playAt, slotMs: SLOT_MS };
  }

  res.status(200).json({ success: true, status: record.status, wave, relay });
});

exports.getMyRecord = catchAsyncError(async (req, res, next) => {
  const session = await getStudentSession(req.params.sessionId, req.user, next);
  if (!session) return;
  const record = await AttendanceRecord.findOne({ session: session._id, email: req.user.email }).select("status reasons acoustic.heardAt");
  await session.populate("class", "courseCode title section");
  res.status(200).json({
    success: true,
    session: { _id: session._id, status: session.status, closesAt: session.closesAt, profile: session.settings.profile, class: session.class },
    record: record ? { status: record.status, reasons: record.reasons, heardAt: record.acoustic?.heardAt } : null,
  });
});
