const { test } = require("node:test");
const assert = require("node:assert/strict");
const report = require("../utils/attendanceReport");
const { startOfWeek } = require("../utils/clock");

const session = (id) => ({ _id: id });
const entry = (email, status = "active") => ({ email, name: email.split("@")[0], identity: { loginId: email.split("@")[0] }, status });
const record = (sessionId, email, status) => ({ _id: `${sessionId}-${email}`, session: sessionId, email, status });

test("report: percent over present + absent, review pending, bands at 75 / 85", () => {
  assert.deepEqual(report.summarise([{ status: "P" }, { status: "P" }, { status: "A" }, { status: "R" }]), { present: 2, absent: 1, pending: 1, counted: 3, percent: 66.7, band: "low" });
  assert.equal(report.summarise([{ status: "P" }, { status: "P" }, { status: "P" }, { status: "A" }]).band, "warn");
  assert.equal(report.summarise([{ status: "P" }]).band, "ok");
  assert.deepEqual(report.summarise([{ status: "R" }]), { present: 0, absent: 0, pending: 1, counted: 0, percent: null, band: "none" });
  assert.equal(report.summarise([]).percent, null);
});

test("report: classes you can still miss / must attend to reach 75%", () => {
  assert.equal(report.canMiss(4, 4), 1); // 4/5 = 80% ok, 4/6 = 67% not
  assert.equal(report.canMiss(3, 4), 0);
  assert.equal(report.canMiss(0, 0), 0);
  assert.equal(report.neededFor(1, 4), 8); // 9/12 = 75%
  assert.equal(report.neededFor(3, 4), 0);
  assert.equal(report.neededFor(0, 1), 3); // 3/4
});

test("report: matrix counts late joiners as absent, removed students only where they have records", () => {
  const sessions = [session("s1"), session("s2"), session("s3")];
  const roster = [entry("a@x.in"), entry("late@x.in"), entry("gone@x.in", "inactive"), entry("never@x.in", "inactive")];
  const records = [
    record("s1", "a@x.in", "present"),
    record("s2", "a@x.in", "review"),
    record("s3", "a@x.in", "present"),
    record("s3", "late@x.in", "present"),
    record("s1", "gone@x.in", "absent"),
    record("s2", "stray@x.in", "present"), // no roster row at all
  ];
  const { students, removed, summary } = report.buildClassMatrix({ sessions, roster, records });

  const a = students.find((row) => row.email === "a@x.in");
  assert.deepEqual(a.cells.map((cell) => cell.status), ["P", "R", "P"]);
  assert.equal(a.percent, 100);
  assert.equal(a.pending, 1);

  const late = students.find((row) => row.email === "late@x.in");
  assert.deepEqual(late.cells.map((cell) => `${cell.status}${cell.implicit ? "*" : ""}`), ["A*", "A*", "P"]);
  assert.equal(late.percent, 33.3);

  assert.deepEqual(removed.map((row) => row.email).sort(), ["gone@x.in", "stray@x.in"]);
  assert.deepEqual(removed.find((row) => row.email === "gone@x.in").cells.map((cell) => cell.status), ["A", "-", "-"]);
  assert.deepEqual(summary, { counted: 3, average: 66.7, below: 1, pending: 1 });
});

test("csv: quoting, formula injection, BOM and CRLF", () => {
  assert.equal(report.csvCell("plain"), "plain");
  assert.equal(report.csvCell('Say "hi", ok'), '"Say ""hi"", ok"');
  assert.equal(report.csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(report.csvCell("-5"), "'-5");
  assert.equal(report.csvCell("@x"), "'@x");
  assert.equal(report.csvCell(null), "");
  assert.equal(report.csvCell(75.5), "75.5");
  const csv = report.toCsv([["a", "b"], ["1", "line\nbreak"]]);
  assert.ok(csv.startsWith("﻿a,b\r\n1,\"line\nbreak\""));
  assert.ok(csv.endsWith("\r\n"));
});

test("csv: IST dates, file names; week starts Monday 00:00 IST", () => {
  assert.equal(report.formatIst(new Date("2026-10-24T09:30:00Z"), "Asia/Kolkata"), "24 Oct 2026 15:00");
  assert.equal(report.formatIst(null), "");
  assert.equal(report.csvFileName({ courseCode: "CS301", section: "A" }, "attendance", new Date("2026-10-24T09:30:00Z")), "CS301-A-attendance-2026-10-24.csv");
  assert.equal(report.csvFileName({ courseCode: "CS 302/x" }, "checkin", new Date("2026-10-24T09:30:00Z")), "CS-302-x-checkin-2026-10-24.csv");
  // Sat 24 Oct 2026 15:00 IST → Mon 19 Oct 00:00 IST = 18 Oct 18:30 UTC.
  assert.equal(startOfWeek(new Date("2026-10-24T09:30:00Z"), "Asia/Kolkata").toISOString(), "2026-10-18T18:30:00.000Z");
  // Mon 19 Oct 00:10 IST is already in that week.
  assert.equal(startOfWeek(new Date("2026-10-18T18:40:00Z"), "Asia/Kolkata").toISOString(), "2026-10-18T18:30:00.000Z");
});
