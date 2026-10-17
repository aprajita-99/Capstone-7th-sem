const mongoose = require("mongoose");
const catchAsyncError = require("../middleware/catchasyncerror");
const ErrorHandler = require("../utils/errorhandler");
const CourseClass = require("../models/classModels");
const Enrollment = require("../models/enrollmentModels");
const { Room } = require("../models/roomModels");
const { MAX_ROSTER_SIZE, normaliseRosterEntry, parseRosterText } = require("../utils/roster");

const getOwnedClass = async (classId, teacherId, next) => {
  if (!mongoose.isValidObjectId(classId)) {
    return next(new ErrorHandler("Class not found", 404));
  }

  const courseClass = await CourseClass.findOne({ _id: classId, teacher: teacherId });
  if (!courseClass) {
    return next(new ErrorHandler("Class not found", 404));
  }

  return courseClass;
};

exports.listRooms = catchAsyncError(async (req, res) => {
  const rooms = await Room.find({}).select("roomNo createdAt").sort({ roomNo: 1 });
  res.status(200).json({ success: true, rooms });
});

exports.createRoom = catchAsyncError(async (req, res, next) => {
  const roomNo = String(req.body.roomNo || "").trim();

  if (!roomNo) {
    return next(new ErrorHandler("Room number is required", 400));
  }
  if (roomNo.length > 40) {
    return next(new ErrorHandler("Room number is too long (max 40 characters)", 400));
  }

  const existing = await Room.findOne({ roomNo });
  if (existing) {
    return next(new ErrorHandler("That room already exists", 409));
  }

  const room = await Room.create({ roomNo });
  res.status(201).json({ success: true, room });
});

exports.createClass = catchAsyncError(async (req, res, next) => {
  const { courseCode, title, section = "", roomId } = req.body;

  if (!courseCode || !title || !roomId) {
    return next(new ErrorHandler("Course code, title, and room are required", 400));
  }

  if (!mongoose.isValidObjectId(roomId) || !(await Room.exists({ _id: roomId }))) {
    return next(new ErrorHandler("Select an existing room", 400));
  }

  const courseClass = await CourseClass.create({
    courseCode,
    title,
    section,
    defaultRoom: roomId,
    teacher: req.user._id,
  });

  await courseClass.populate("defaultRoom", "roomNo");
  res.status(201).json({ success: true, courseClass });
});

exports.listClasses = catchAsyncError(async (req, res) => {
  const includeArchived = req.query.archived === "1";
  const classes = await CourseClass.find({
    teacher: req.user._id,
    ...(includeArchived ? {} : { archived: { $ne: true } }),
  })
    .populate("defaultRoom", "roomNo")
    .sort({ createdAt: -1 });

  const counts = await Enrollment.aggregate([
    { $match: { class: { $in: classes.map((courseClass) => courseClass._id) }, status: "active" } },
    { $group: { _id: "$class", count: { $sum: 1 } } },
  ]);
  const countsByClass = new Map(counts.map((count) => [count._id.toString(), count.count]));

  res.status(200).json({
    success: true,
    classes: classes.map((courseClass) => ({
      ...courseClass.toObject(),
      activeStudentCount: countsByClass.get(courseClass._id.toString()) || 0,
    })),
  });
});

exports.getClass = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;

  await courseClass.populate("defaultRoom", "roomNo");
  const activeStudentCount = await Enrollment.countDocuments({ class: courseClass._id, status: "active" });
  res.status(200).json({ success: true, courseClass: { ...courseClass.toObject(), activeStudentCount } });
});

exports.updateClass = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;

  const { title, section, roomId } = req.body;
  if (title !== undefined) {
    if (!String(title).trim()) return next(new ErrorHandler("Class title cannot be empty", 400));
    courseClass.title = title;
  }
  if (section !== undefined) courseClass.section = section;
  if (roomId !== undefined) {
    if (!mongoose.isValidObjectId(roomId) || !(await Room.exists({ _id: roomId }))) {
      return next(new ErrorHandler("Select an existing room", 400));
    }
    courseClass.defaultRoom = roomId;
  }

  await courseClass.save();
  await courseClass.populate("defaultRoom", "roomNo");
  res.status(200).json({ success: true, courseClass });
});

// Body { archived: false } restores an archived class; anything else archives it.
exports.archiveClass = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;

  const archived = req.body?.archived !== false;
  courseClass.archived = archived;
  courseClass.archivedAt = archived ? new Date() : undefined;
  await courseClass.save();
  await courseClass.populate("defaultRoom", "roomNo");
  res.status(200).json({ success: true, courseClass });
});

exports.addRosterStudent = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;

  const { entry, error } = normaliseRosterEntry(req.body.email, req.body.name);
  if (error) return next(new ErrorHandler(error, 400));

  const existing = await Enrollment.findOne({ class: courseClass._id, email: entry.email });
  if (existing?.status === "active") {
    return next(new ErrorHandler("This student is already on the roster", 409));
  }
  const activeCount = await Enrollment.countDocuments({ class: courseClass._id, status: "active" });
  if (activeCount >= MAX_ROSTER_SIZE) {
    return next(new ErrorHandler(`A single class roster can contain at most ${MAX_ROSTER_SIZE} students.`, 400));
  }

  const enrollment = await Enrollment.findOneAndUpdate(
    { class: courseClass._id, email: entry.email },
    {
      $set: {
        // Keep a previously stored name when re-adding without one.
        ...(entry.name || !existing ? { name: entry.name } : {}),
        identity: entry.identity,
        status: "active",
        rosterUpdatedAt: new Date(),
      },
      $setOnInsert: { class: courseClass._id, email: entry.email },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ success: true, enrollment });
});

exports.removeRosterStudent = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;

  const email = String(req.params.email || "").trim().toLowerCase();
  const enrollment = await Enrollment.findOneAndUpdate(
    { class: courseClass._id, email, status: "active" },
    { $set: { status: "inactive", rosterUpdatedAt: new Date() } },
    { new: true }
  );
  if (!enrollment) return next(new ErrorHandler("Student not found on this roster", 404));

  res.status(200).json({ success: true, message: "Student removed from the roster" });
});

exports.previewRoster = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;

  const preview = parseRosterText(req.body.rosterText);
  res.status(200).json({ success: true, preview });
});

exports.replaceRoster = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;

  const { entries, errors } = parseRosterText(req.body.rosterText);
  if (errors.length > 0) {
    return next(new ErrorHandler("Fix roster validation errors before saving", 400));
  }
  if (entries.length === 0) {
    return next(new ErrorHandler("A class must have at least one student", 400));
  }

  const updatedAt = new Date();
  await Enrollment.bulkWrite(
    entries.map((entry) => ({
      updateOne: {
        filter: { class: courseClass._id, email: entry.email },
        update: {
          $set: {
            name: entry.name,
            identity: entry.identity,
            status: "active",
            rosterUpdatedAt: updatedAt,
          },
          $setOnInsert: { class: courseClass._id, email: entry.email },
        },
        upsert: true,
      },
    }))
  );

  await Enrollment.updateMany(
    { class: courseClass._id, email: { $nin: entries.map((entry) => entry.email) } },
    { $set: { status: "inactive", rosterUpdatedAt: updatedAt } }
  );

  const activeStudentCount = await Enrollment.countDocuments({ class: courseClass._id, status: "active" });
  res.status(200).json({
    success: true,
    message: "Roster saved",
    activeStudentCount,
  });
});

exports.getRoster = catchAsyncError(async (req, res, next) => {
  const courseClass = await getOwnedClass(req.params.classId, req.user._id, next);
  if (!courseClass) return;

  const enrollments = await Enrollment.find({ class: courseClass._id, status: "active" })
    .sort({ "identity.rollNumber": 1, email: 1 });
  res.status(200).json({ success: true, enrollments });
});
