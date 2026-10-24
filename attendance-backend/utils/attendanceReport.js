/**
 * Attendance reports (Phase 11), kept pure so they can be unit-tested.
 *
 * - Only closed and locked check-ins count; open (live) ones are left out.
 * - present → P, absent → A, review / heard / joined → R (pending: shown but
 *   not counted until decided).
 * - A current roster student with no record for a counted check-in (joined
 *   the roster later) counts as absent (owner decision); a removed student
 *   with no record is simply not counted ("-").
 * - % = present / (present + absent); below 75% is "low", below 85% "warn".
 */
const { timeZone, localDay } = require("./clock");

const MIN_PERCENT = 75;
const WARN_PERCENT = 85;
const COUNTED_SESSION_STATUSES = ["closed", "locked"];

const cellStatus = (record, { current = true } = {}) => {
  if (!record) return current ? { status: "A", implicit: true } : { status: "-", implicit: false };
  if (record.status === "present") return { status: "P", implicit: false };
  if (record.status === "absent") return { status: "A", implicit: false };
  return { status: "R", implicit: false };
};

const band = (percent) => {
  if (percent === null) return "none";
  if (percent < MIN_PERCENT) return "low";
  if (percent < WARN_PERCENT) return "warn";
  return "ok";
};

const roundOne = (value) => Math.round(value * 10) / 10;

const summarise = (cells) => {
  const present = cells.filter((cell) => cell.status === "P").length;
  const absent = cells.filter((cell) => cell.status === "A").length;
  const pending = cells.filter((cell) => cell.status === "R").length;
  const counted = present + absent;
  const percent = counted ? roundOne((present / counted) * 100) : null;
  return { present, absent, pending, counted, percent, band: band(percent) };
};

// How many more classes can be missed and still stay at or above 75%.
const canMiss = (present, counted) => Math.max(0, Math.floor((4 * present - 3 * counted) / 3));
// How many classes in a row must be attended to reach 75%.
const neededFor = (present, counted) => Math.max(0, 3 * counted - 4 * present);

/**
 * sessions: counted check-ins, oldest first ({_id, ...}).
 * roster: Enrollment rows ({email, name, identity, status: active|inactive}).
 * records: AttendanceRecord rows of those sessions.
 */
const buildClassMatrix = ({ sessions, roster, records }) => {
  const byKey = new Map(records.map((record) => [`${record.session}|${record.email}`, record]));
  const known = new Map(roster.map((entry) => [entry.email, entry]));
  // Students with records but no roster row at all are shown as removed.
  records.forEach((record) => {
    if (!known.has(record.email)) known.set(record.email, { email: record.email, name: "", identity: {}, status: "inactive" });
  });

  const rows = [...known.values()].map((entry) => {
    const current = entry.status === "active";
    const cells = sessions.map((session) => {
      const record = byKey.get(`${session._id}|${entry.email}`);
      return { sessionId: session._id, recordId: record?._id || null, ...cellStatus(record, { current }) };
    });
    return {
      email: entry.email,
      name: entry.name || "",
      rollNumber: entry.identity?.rollNumber || "",
      loginId: entry.identity?.loginId || entry.email.split("@")[0],
      current,
      cells,
      ...summarise(cells),
    };
  });

  const byRoll = (left, right) => (left.loginId || left.email).localeCompare(right.loginId || right.email);
  const students = rows.filter((row) => row.current).sort(byRoll);
  const removed = rows.filter((row) => !row.current && row.cells.some((cell) => cell.status !== "-")).sort(byRoll);
  const withPercent = students.filter((row) => row.percent !== null);
  return {
    students,
    removed,
    summary: {
      counted: sessions.length,
      average: withPercent.length ? roundOne(withPercent.reduce((sum, row) => sum + row.percent, 0) / withPercent.length) : null,
      below: students.filter((row) => row.band === "low").length,
      pending: students.reduce((sum, row) => sum + row.pending, 0),
    },
  };
};

// ---------- CSV ----------

// One CSV cell: quoted when needed; cells that Excel would run as a formula get a leading apostrophe.
const csvCell = (value) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// UTF-8 BOM so Excel shows names correctly; CRLF line ends.
const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

// "24 Oct 2026 15:00" in the college time zone.
const formatIst = (date, zone = timeZone()) => {
  if (!date) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(date))
      .map((part) => [part.type, part.value])
  );
  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}`;
};

// CS301-A-attendance-2026-10-24.csv
const csvFileName = (courseClass, kind, date = new Date()) => {
  const label = [courseClass?.courseCode, courseClass?.section].filter(Boolean).join("-") || "class";
  return `${label}-${kind}-${localDay(date)}.csv`.replace(/[^A-Za-z0-9.-]+/g, "-");
};

module.exports = {
  MIN_PERCENT,
  WARN_PERCENT,
  COUNTED_SESSION_STATUSES,
  cellStatus,
  band,
  summarise,
  canMiss,
  neededFor,
  buildClassMatrix,
  csvCell,
  toCsv,
  formatIst,
  csvFileName,
};
