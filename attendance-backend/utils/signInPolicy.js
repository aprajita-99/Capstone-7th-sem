/**
 * Google sign-in policy (shared by the auth controller and its unit tests).
 *
 * Rule: any Google account with a verified email may attempt sign-in. Students
 * must be on an active class roster (any email domain the teacher added);
 * teachers must already be teachers or be listed in TEACHER_EMAILS.
 *
 * Testing rule: addresses listed in TEST_STUDENT_EMAILS (e.g. a couple of
 * friendly Gmail accounts) may also sign in and are treated as students.
 * They are never on a college roster, so the roster gate is skipped for them.
 * Remove the variable (or empty it) before the real pilot.
 *
 * The environment is read on every call so tests (and future config reloads)
 * always see the current values.
 */

const WORKSPACE_DOMAIN = "nitjsr.ac.in";

const normaliseEmail = (email) => String(email || "").trim().toLowerCase();

const parseEmailList = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const provisionedTeacherEmails = () => parseEmailList(process.env.TEACHER_EMAILS);

const testStudentEmails = () => parseEmailList(process.env.TEST_STUDENT_EMAILS);

const isProvisionedTeacher = (email) => provisionedTeacherEmails().includes(normaliseEmail(email));

const isTestStudent = (email) => testStudentEmails().includes(normaliseEmail(email));

const isWorkspaceAccount = (email) => normaliseEmail(email).endsWith(`@${WORKSPACE_DOMAIN}`);

// A plain, single-address email ("name@domain.tld"), any domain.
const isValidEmail = (email) => /^[^\s@,;"<>]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(normaliseEmail(email));

const isAllowedSignInEmail = (email) => isValidEmail(email);

module.exports = {
  WORKSPACE_DOMAIN,
  normaliseEmail,
  parseEmailList,
  provisionedTeacherEmails,
  testStudentEmails,
  isProvisionedTeacher,
  isTestStudent,
  isWorkspaceAccount,
  isValidEmail,
  isAllowedSignInEmail,
};
