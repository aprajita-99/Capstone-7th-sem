const express = require("express");
const isAuthenticated = require("../middleware/auth");
const { listMyClasses } = require("../controllers/meController");

const router = express.Router();

router.get("/me/classes", isAuthenticated, isAuthenticated.authorizeRoles("student"), listMyClasses);

module.exports = router;
