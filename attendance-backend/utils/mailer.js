/**
 * Outgoing email through the Brevo HTTP API (Phase 10: teacher evening digest).
 * Render's free tier blocks SMTP ports, so this uses HTTPS + fetch. Without
 * BREVO_API_KEY / MAIL_FROM every send is skipped and logged.
 */
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

let testSender = null;

const isConfigured = () => Boolean(testSender || (process.env.BREVO_API_KEY && process.env.MAIL_FROM));

const setSenderForTests = (sender) => {
  testSender = sender;
};

const send = async ({ to, subject, text, html }) => {
  if (testSender) return testSender({ to, subject, text, html });
  if (!isConfigured()) {
    console.log(`email skipped (not configured): ${subject}`);
    return { skipped: true };
  }
  const response = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || "Bio Attend" },
      to: [{ email: to.email, name: to.name || undefined }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!response.ok) throw new Error(`email failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return { sent: true };
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

/**
 * Evening digest for one teacher.
 * groups: [{ courseCode, section, title, startedAt (Date), reviews, queries, lockAt (Date) }]
 * → { subject, text, html }
 */
const buildDigest = ({ teacherName, groups, appUrl, formatTime = (date) => date.toISOString() }) => {
  const total = groups.reduce((sum, group) => sum + group.reviews, 0);
  const queries = groups.reduce((sum, group) => sum + group.queries, 0);
  const link = `${String(appUrl || "").replace(/\/+$/, "")}/teacher/reviews?tab=attendance`;
  const subject = `Bio Attend: ${total} attendance review${total === 1 ? "" : "s"} waiting${queries ? ` (${queries} from student queries)` : ""}`;
  const label = (group) => `${group.courseCode}${group.section ? ` · ${group.section}` : ""}`;
  const line = (group) =>
    `${label(group)} (${formatTime(group.startedAt)}): ${group.reviews} to review${group.queries ? `, ${group.queries} with a student query` : ""}. Locks ${formatTime(group.lockAt)}.`;

  const text = [
    `Hi ${teacherName || "there"},`,
    "",
    "These check-ins still have students waiting for your decision:",
    ...groups.map((group) => `- ${line(group)}`),
    "",
    "Undecided cases are marked absent when the check-in locks.",
    `Open your reviews: ${link}`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(teacherName || "there")},</p>`,
    "<p>These check-ins still have students waiting for your decision:</p>",
    `<ul>${groups.map((group) => `<li><strong>${escapeHtml(label(group))}</strong> ${escapeHtml(line(group).slice(label(group).length))}</li>`).join("")}</ul>`,
    "<p>Undecided cases are marked absent when the check-in locks.</p>",
    `<p><a href="${escapeHtml(link)}">Open your reviews</a></p>`,
  ].join("");

  return { subject, text, html };
};

module.exports = { isConfigured, send, setSenderForTests, buildDigest, escapeHtml };
