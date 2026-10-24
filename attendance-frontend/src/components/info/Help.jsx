import React from "react";
import { Link } from "react-router-dom";
import InfoLayout from "./InfoLayout";

const SECTIONS = [
  {
    title: "Signing in",
    items: [
      {
        q: "It says I can't sign in / I'm not on a roster",
        a: "Students can sign in only after a teacher adds their college email to a class roster. Ask your teacher to check that your email (e.g. 2023ugcs001@nitjsr.ac.in) is on the roster, then try again.",
      },
      {
        q: "Which account should I use?",
        a: "Your NIT Jamshedpur Google account. Teachers and students use the same “Sign in with Google” button — the app opens the right pages for you.",
      },
      {
        q: "I'm a teacher but I see the student pages",
        a: "Teacher access is turned on for your email by the MarkMePresent admin. Ask them to add your email, then sign out and sign in again.",
      },
    ],
  },
  {
    title: "Your phone",
    items: [
      {
        q: "“This phone isn't approved”",
        a: "Check-ins only count from the phone you first signed in on. If you changed phones, sign in on the new one: if your identity is verified you can confirm it with a quick face check; otherwise your teacher approves it on the Reviews page.",
      },
      {
        q: "Does it work on iPhone?",
        a: "Not yet — MarkMePresent is built for Android phones with Chrome. On other phones, tell your teacher; they can mark you from the review list.",
      },
      {
        q: "Test my phone's speaker and microphone",
        a: "Open the Sound test (in the menu) to check that your phone can play and hear the near-silent tones.",
      },
    ],
  },
  {
    title: "Identity check (first time)",
    items: [
      {
        q: "My ID card photo is rejected",
        a: "Take the photo of the front of the card, flat on a table, in good light without glare. Your photo and roll number must be readable. A rejected photo doesn't use up an attempt.",
      },
      {
        q: "The live selfie keeps failing",
        a: "Face a light source, hold the phone at eye level, remove anything covering your face, and follow the oval. Use your real face — not a photo or screen. You have 3 attempts; after that your teacher can reset them.",
      },
      {
        q: "It says “Waiting for your teacher”",
        a: "The match wasn't certain (or the roll number couldn't be read), so your teacher checks it by hand. You'll see the result on your dashboard.",
      },
    ],
  },
  {
    title: "During a check-in",
    items: [
      {
        q: "My phone can't hear the key",
        a: "Keep the page open with the screen on and the phone out of your pocket, face-up. Allow the microphone. Move a little closer to the front or to a classmate whose phone is out — phones pass the key on to the back rows. It keeps trying until the check-in closes; if it never hears it, you go to your teacher's review list, not straight to absent.",
      },
      {
        q: "The camera won't open for the face check",
        a: "Allow camera access when Chrome asks (or in Chrome's site settings), close other apps using the camera, and try again. You get two tries; after that you can choose “Skip — let my teacher review”.",
      },
      {
        q: "The check-in closed before I finished the face check",
        a: "If your phone heard the key in time, you still have 2 minutes after the check-in closes to finish the face check.",
      },
    ],
  },
  {
    title: "After class",
    items: [
      {
        q: "I'm “In review” or marked absent by mistake",
        a: "Open the check-in from your dashboard or Attendance page and tap “Raise a query” — choose what happened and add a short note. You can raise one query per check-in, until it locks at 09:00 the next morning.",
      },
      {
        q: "What does my attendance % count?",
        a: "Closed check-ins only: present out of present + absent. Cases in review count once your teacher decides. Check-ins before you were added to the roster count as absent. You need at least 75%.",
      },
    ],
  },
  {
    title: "For teachers",
    items: [
      {
        q: "Before starting a check-in",
        a: "Turn the phone's media volume to maximum, run the 8-second speaker check, and keep the phone face-up with the screen on, away from the door.",
      },
      {
        q: "Reviewing unsure cases",
        a: "Open Reviews → Attendance. Decide each case (or select several and mark them present) before 09:00 the next morning — undecided cases are then marked absent.",
      },
      {
        q: "Exporting attendance",
        a: "Open the class → Attendance tab → Export CSV, or a single check-in's summary → Export CSV. The files open in Excel.",
      },
    ],
  },
];

/** Help page (public, /help): common problems by situation. */
const Help = () => (
  <InfoLayout title="Help" subtitle="Quick answers to the most common problems. Still stuck? Ask your teacher.">
    {SECTIONS.map((section) => (
      <section key={section.title} className="info-section">
        <h2>{section.title}</h2>
        <div className="faq">
          {section.items.map((item) => (
            <details key={item.q} className="faq__item">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    ))}

    <section className="info-section">
      <h2>Contact</h2>
      <p>
        Talk to your <strong>class teacher</strong> first. For anything they can't resolve, contact the
        <strong> Department of Computer Science &amp; Engineering, NIT Jamshedpur</strong>.
      </p>
      <p className="info-note">How your data is handled: <Link to="/privacy">Privacy notice</Link>.</p>
    </section>
  </InfoLayout>
);

export default Help;
