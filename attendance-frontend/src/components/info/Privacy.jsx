import React from "react";
import { Link } from "react-router-dom";
import InfoLayout from "./InfoLayout";

const DATA = [
  {
    what: "Your Google account name and college email",
    why: "To sign you in and match you to your class rosters.",
    kept: "While you have an account.",
  },
  {
    what: "Roster details your teacher adds (name, roll number from your email)",
    why: "To know which classes you belong to.",
    kept: "While you are on the roster; past attendance stays with the class record.",
  },
  {
    what: "Your phone's device key (public half only)",
    why: "So check-ins only count from your own phone. The private half never leaves the phone.",
    kept: "While you have an account; replaced when you approve a new phone.",
  },
  {
    what: "Photo of your college ID card",
    why: "To confirm your identity once, against your live selfie.",
    kept: "Deleted as soon as your identity is verified (or when a teacher rejects or resets it).",
  },
  {
    what: "Your enrolled face (a frame from your live selfie)",
    why: "The reference that each check-in's face check is compared with.",
    kept: "While you are on at least one active class roster. Deleted when you leave all rosters or a teacher resets your identity check.",
  },
  {
    what: "Check-in evidence: one face frame, IP address and browser name",
    why: "So your teacher can look at unsure cases.",
    kept: "Deleted when the check-in locks, at 09:00 the next morning (at the latest 48 hours).",
  },
  {
    what: "Attendance records (present / review / absent, reasons, teacher decisions)",
    why: "Your class attendance.",
    kept: "Kept as the class attendance record.",
  },
  {
    what: "Queries you raise and the audit log of decisions",
    why: "So decisions are fair and can be checked.",
    kept: "180 days.",
  },
];

/** Privacy notice (public, /privacy). Plain language; matches what the system actually stores. */
const Privacy = () => (
  <InfoLayout title="Privacy notice" subtitle="What MarkMePresent collects, why, who can see it, and when it is deleted. Last updated 25 October 2026.">
    <section className="info-section">
      <h2>Who runs MarkMePresent</h2>
      <p>
        MarkMePresent is an attendance system built at the Department of Computer Science &amp; Engineering, NIT Jamshedpur.
        It is used by teachers of NIT Jamshedpur to take attendance in their classes.
      </p>
    </section>

    <section className="info-section">
      <h2>What we collect, why, and for how long</h2>
      <div className="info-table-wrap">
        <table className="info-table">
          <thead>
            <tr><th scope="col">What</th><th scope="col">Why</th><th scope="col">How long</th></tr>
          </thead>
          <tbody>
            {DATA.map((row) => (
              <tr key={row.what}>
                <th scope="row">{row.what}</th>
                <td data-label="Why">{row.why}</td>
                <td data-label="How long">{row.kept}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section className="info-section">
      <h2>What we do not collect</h2>
      <ul>
        <li><strong>No location.</strong> GPS is never used; presence is proven by sound inside the room.</li>
        <li><strong>No audio recordings.</strong> Your phone listens for the key and works it out on the phone; only the key number is sent, nothing is recorded or uploaded.</li>
        <li><strong>No video stored.</strong> The live face check streams to the face service for a few seconds; only one still frame is kept, as described above.</li>
        <li>No contacts, photos from your gallery (other than the ID card photo you choose), or other apps' data.</li>
      </ul>
    </section>

    <section className="info-section">
      <h2>Who can see your data</h2>
      <ul>
        <li><strong>You</strong> — your own status, attendance and queries.</li>
        <li><strong>Teachers of your classes</strong> — your attendance, your enrolled face and check-in frames (while they exist), your ID card while your identity check is waiting for review, and your queries.</li>
        <li><strong>The people who maintain the system</strong> — only to keep it running and fix problems.</li>
      </ul>
      <p>Your data is never sold, never shared for advertising and never made public.</p>
    </section>

    <section className="info-section">
      <h2>Services that process data for us</h2>
      <ul>
        <li><strong>Google</strong> — sign-in with your college account.</li>
        <li><strong>Amazon Web Services (Rekognition, Mumbai region)</strong> — the live face check and face comparison.</li>
        <li><strong>MongoDB Atlas (Mumbai region)</strong> — where the data above is stored.</li>
        <li><strong>Render and Vercel</strong> — host the server and the website.</li>
        <li><strong>Brevo</strong> — sends teachers a daily email with the number of open reviews (no student photos or personal details).</li>
      </ul>
    </section>

    <section className="info-section">
      <h2>Cookies and storage on your phone</h2>
      <p>
        One sign-in cookie keeps you logged in. Your browser also stores your phone's device key and a few small settings
        (for example, if you chose “Later” for the identity check). Nothing is used for tracking or advertising.
      </p>
    </section>

    <section className="info-section">
      <h2>Your choices and rights</h2>
      <p>Under India's Digital Personal Data Protection Act, 2023 you can:</p>
      <ul>
        <li><strong>See your data</strong> — your attendance and status are on your dashboard and Attendance page.</li>
        <li><strong>Correct it</strong> — raise a query on a check-in, or ask your teacher to fix your roster details.</li>
        <li><strong>Have photos deleted</strong> — ask your teacher to reset your identity check; photos are also deleted automatically as described above.</li>
        <li><strong>Withdraw consent</strong> — you can stop using the face check; ask your teacher to mark your attendance another way.</li>
      </ul>
    </section>

    <section className="info-section">
      <h2>Questions or complaints</h2>
      <p>
        Talk to your <strong>class teacher</strong> first. If it is not resolved, contact the
        <strong> Department of Computer Science &amp; Engineering, NIT Jamshedpur</strong>.
      </p>
      <p className="info-note">See also the <Link to="/help">Help page</Link> for common problems.</p>
    </section>
  </InfoLayout>
);

export default Privacy;
