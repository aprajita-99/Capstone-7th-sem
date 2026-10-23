// Which students a teacher may review: those on one of the teacher's active
// rosters, plus test accounts (never on a roster) during development.
const User = require("../models/userModels");
const CourseClass = require("../models/classModels");
const Enrollment = require("../models/enrollmentModels");
const { isTestStudent, normaliseEmail, testStudentEmails } = require("./signInPolicy");

const reviewableStudentEmails = async (teacherId) => {
  const classes = await CourseClass.find({ teacher: teacherId }).select("_id");
  const enrolled = await Enrollment.distinct("email", { class: { $in: classes.map((courseClass) => courseClass._id) }, status: "active" });
  return [...new Set([...enrolled.map(normaliseEmail), ...testStudentEmails()])];
};

const teacherCanReviewStudent = async (teacherId, studentId) => {
  const student = await User.findById(studentId).select("email");
  if (!student) return false;
  if (isTestStudent(student.email)) return true;
  const classes = await CourseClass.find({ teacher: teacherId }).select("_id");
  if (classes.length === 0) return false;
  return Boolean(await Enrollment.exists({ class: { $in: classes.map((courseClass) => courseClass._id) }, email: student.email, status: "active" }));
};

module.exports = { reviewableStudentEmails, teacherCanReviewStudent };
