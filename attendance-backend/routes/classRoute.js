const express = require("express");
const isAuthenticated = require("../middleware/auth");
const {
  listRooms,
  createRoom,
  createClass,
  listClasses,
  getClass,
  updateClass,
  archiveClass,
  previewRoster,
  replaceRoster,
  getRoster,
  addRosterStudent,
  removeRosterStudent,
} = require("../controllers/classController");

const router = express.Router();
const teacherOnly = isAuthenticated.authorizeRoles("teacher");
const guards = [isAuthenticated, teacherOnly];

// Guards are attached per route on purpose. A blanket router.use() here would
// also swallow every /api/v1 route mounted after this router (Google sign-in,
// device bindings) and answer them with 401 before they can run.
router.get("/rooms", guards, listRooms);
router.post("/rooms", guards, createRoom);
router.route("/classes").get(guards, listClasses).post(guards, createClass);
router.route("/classes/:classId").get(guards, getClass).patch(guards, updateClass);
router.post("/classes/:classId/archive", guards, archiveClass);
router.post("/classes/:classId/roster/preview", guards, previewRoster);
router.put("/classes/:classId/roster", guards, replaceRoster);
router.get("/classes/:classId/roster", guards, getRoster);
router.post("/classes/:classId/roster/students", guards, addRosterStudent);
router.delete("/classes/:classId/roster/students/:email", guards, removeRosterStudent);

module.exports = router;
