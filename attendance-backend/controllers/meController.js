const catchAsyncError = require("../middleware/catchasyncerror");
const Enrollment = require("../models/enrollmentModels");
const CourseClass = require("../models/classModels");

// Classes the signed-in student is actively enrolled in (archived classes hidden).
exports.listMyClasses = catchAsyncError(async (req, res) => {
  const classIds = await Enrollment.distinct("class", { email: req.user.email, status: "active" });
  const classes = await CourseClass.find({ _id: { $in: classIds }, archived: { $ne: true } })
    .select("courseCode title section defaultRoom teacher")
    .populate("defaultRoom", "roomNo")
    .populate("teacher", "name")
    .sort({ courseCode: 1 });

  res.status(200).json({ success: true, classes });
});
