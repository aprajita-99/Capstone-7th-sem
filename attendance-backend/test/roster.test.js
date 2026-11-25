const test = require("node:test");
const assert = require("node:assert/strict");
const { normaliseRosterEntry, parseRosterText } = require("../utils/roster");

test("single-student add uses the same rules as CSV import", () => {
  const { entry, error } = normaliseRosterEntry("  2023UGCS111@NITJSR.AC.IN ", " Aprajita ");
  assert.equal(error, undefined);
  assert.equal(entry.email, "2023ugcs111@nitjsr.ac.in");
  assert.equal(entry.name, "Aprajita");
  assert.equal(entry.identity.rollNumber, "111");

  assert.equal(normaliseRosterEntry(" Someone@Gmail.com ").entry.email, "someone@gmail.com");
  assert.equal(normaliseRosterEntry("x@sub.example.edu").error, undefined);
  assert.match(normaliseRosterEntry("").error, /valid email/);
  assert.match(normaliseRosterEntry("not-an-email").error, /valid email/);
  assert.match(normaliseRosterEntry("a@b").error, /valid email/);
  assert.equal(normaliseRosterEntry("a b@nitjsr.ac.in").entry, undefined);
});

test("a header row is skipped only on the first non-empty line", () => {
  const { entries, errors } = parseRosterText("\n Email ,Name\n2023ugcs001@nitjsr.ac.in\nemail");
  assert.equal(entries.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 4);
});

test("accepts a CSV header and derives identity fields from a college email", () => {
  const { entries, errors } = parseRosterText(
    "email,name\n2023ugcs059@nitjsr.ac.in,Shivansh Singh"
  );

  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].email, "2023ugcs059@nitjsr.ac.in");
  assert.deepEqual(entries[0].identity, {
    loginId: "2023ugcs059",
    batch: "2023",
    programmeBranch: "UGCS",
    rollNumber: "059",
  });
});

test("accepts any email domain and reports duplicate and malformed rows", () => {
  const { entries, errors } = parseRosterText([
    "2023ugcs059@nitjsr.ac.in",
    "2023ugcs059@nitjsr.ac.in",
    "student@example.com",
    "student-at-example.com",
  ].join("\n"));

  assert.equal(entries.length, 2);
  assert.equal(entries[1].email, "student@example.com");
  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /Duplicate/);
  assert.match(errors[1].message, /valid email/);
});

test("parses a quoted CSV name without changing the email", () => {
  const { entries, errors } = parseRosterText(
    '2023ugcs060@nitjsr.ac.in,"Singh, Student"'
  );

  assert.deepEqual(errors, []);
  assert.equal(entries[0].name, "Singh, Student");
});
