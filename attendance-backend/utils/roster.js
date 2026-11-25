const { isValidEmail } = require("./signInPolicy");

const INSTITUTIONAL_DOMAIN = "nitjsr.ac.in";

const splitCsvLine = (line) => {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell.trim());
  return { cells, valid: !quoted };
};

const deriveIdentity = (email) => {
  const loginId = email.split("@")[0];
  const match = loginId.match(/^(\d{4})([a-z]+)(\d+)$/i);

  if (!match) {
    return { loginId };
  }

  return {
    loginId,
    batch: match[1],
    programmeBranch: match[2].toUpperCase(),
    rollNumber: match[3],
  };
};

const MAX_ROSTER_SIZE = 250;

// Validate one roster row. Shared by CSV import and single-student add so both
// follow exactly the same rules.
const normaliseRosterEntry = (rawEmail, rawName = "") => {
  const email = String(rawEmail || "").trim().toLowerCase();
  const name = String(rawName || "").trim().slice(0, 120);

  // Any email domain is allowed; being on the roster is what lets a student sign in.
  if (!isValidEmail(email)) {
    return { error: "Use a valid email address." };
  }

  return { entry: { email, name, identity: deriveIdentity(email) } };
};

const parseRosterText = (rosterText) => {
  if (typeof rosterText !== "string" || !rosterText.trim()) {
    return { entries: [], errors: [{ row: null, message: "Paste a CSV or one college email per line." }] };
  }

  const errors = [];
  const entries = [];
  const seenEmails = new Set();
  const lines = rosterText.replace(/^\uFEFF/, "").split(/\r?\n/);
  let firstDataLine = true;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const row = index + 1;

    if (!line) return;

    const { cells, valid } = splitCsvLine(line);
    if (!valid) {
      errors.push({ row, message: "Unclosed quote in CSV row." });
      return;
    }

    const headerCell = (cells[0] || "").trim().toLowerCase();
    if (firstDataLine && ["email", "college email", "student email"].includes(headerCell)) {
      firstDataLine = false;
      return;
    }
    firstDataLine = false;

    const { entry, error } = normaliseRosterEntry(cells[0], cells[1]);
    if (error) {
      errors.push({ row, message: error });
      return;
    }

    if (seenEmails.has(entry.email)) {
      errors.push({ row, message: "Duplicate email in this roster." });
      return;
    }

    seenEmails.add(entry.email);
    entries.push(entry);
  });

  if (entries.length > MAX_ROSTER_SIZE) {
    errors.push({ row: null, message: `A single class roster can contain at most ${MAX_ROSTER_SIZE} students.` });
  }

  return { entries, errors };
};

module.exports = { INSTITUTIONAL_DOMAIN, MAX_ROSTER_SIZE, normaliseRosterEntry, parseRosterText };
