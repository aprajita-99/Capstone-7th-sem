import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Navbar from './Navbar/navbar';
import './Home.css';
import { FaUserShield, FaVolumeUp, FaMobileAlt, FaFileCsv, FaUserGraduate, FaChalkboardTeacher } from 'react-icons/fa';

// Decorative equalizer in the hero — deterministic heights, pure CSS animation.
const WAVE = [8, 14, 22, 30, 18, 26, 12, 20, 28, 16, 24, 10, 18, 26, 32, 22, 14, 20, 28, 16, 10, 24, 30, 18, 12, 22, 16, 26];

function Home() {
  const location = useLocation();

  // Links like /#sign-in (from the login page) scroll to that section.
  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  return (
    <>
      <Navbar />
      <div className="home">
        <section className="hero">
          <div className="hero__inner">
            <h1>
              Attendance that proves
              <span className="hero__accent">who’s in the room.</span>
            </h1>
            <p className="hero__sub">
              Each student’s phone hears a near-silent key played in class, then a quick live face check
              confirms it’s really them. No GPS, no roll call, no extra hardware.
            </p>
            <div className="hero__actions">
              <Link to="/login" className="ui-btn ui-btn--primary ui-btn--lg">Sign in with college Google</Link>
              <a href="#sign-in" className="ui-btn ui-btn--secondary ui-btn--lg">How to sign in</a>
            </div>
            <div className="hero__wave" aria-hidden="true">
              {WAVE.map((height, index) => (
                <span key={index} style={{ height: `${height}px`, animationDelay: `${(index % 7) * 0.12}s` }} />
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="sign-in">
          <p className="section__eyebrow">Sign in</p>
          <h2>How to sign in</h2>
          <p className="section__sub">Teachers and students use the same <strong>Sign in with Google</strong> button — MarkMePresent recognises which you are.</p>
          <div className="signin__grid">
            <article className="signin-card">
              <span className="signin-card__icon"><FaUserGraduate /></span>
              <h3>Students</h3>
              <ol className="signin-card__steps">
                <li>Sign in with your <strong>college Google account</strong> (e.g. 2023ugcs001@nitjsr.ac.in) on <strong>your own phone</strong>.</li>
                <li>It works once your teacher has added your email to a class roster.</li>
                <li>First time only: this phone is linked to you, then a 2-minute identity check (photo of your college ID card + a live selfie).</li>
                <li>Every class: when your teacher starts a check-in, tap <strong>Join</strong>.</li>
              </ol>
              <Link to="/login" className="ui-btn ui-btn--primary">Student sign in</Link>
            </article>
            <article className="signin-card">
              <span className="signin-card__icon"><FaChalkboardTeacher /></span>
              <h3>Teachers</h3>
              <ol className="signin-card__steps">
                <li>Sign in with your <strong>NIT Jamshedpur Google account</strong>.</li>
                <li>Teacher access is turned on for your email by the MarkMePresent admin — if you land on a student page, ask them to add you.</li>
                <li>Create a class and add its roster (paste or upload the CSV of student emails).</li>
                <li>In class, start a check-in from your phone; review any unsure cases before 9:00 the next morning.</li>
              </ol>
              <Link to="/login" className="ui-btn ui-btn--secondary">Teacher sign in</Link>
            </article>
          </div>
        </section>

        <div className="band">
        <section className="section" id="how">
          <p className="section__eyebrow">Every class</p>
          <h2>How a check-in works</h2>
          <p className="section__sub">Three steps, about a minute, nothing for students to install.</p>
          <div className="steps__grid">
            <article className="step">
              <span className="step__num">1</span>
              <h3>Teacher starts a check-in</h3>
              <p>The server mints a one-time key for the class — it exists for minutes, not days.</p>
            </article>
            <article className="step">
              <span className="step__num">2</span>
              <h3>Phones hear the key</h3>
              <p>Student phones listen for near-silent tones played in the room, then pass them on to classmates further back.</p>
            </article>
            <article className="step">
              <span className="step__num">3</span>
              <h3>A quick face check</h3>
              <p>A live selfie confirms the right person holds the phone. The server decides; unsure cases go to the teacher.</p>
            </article>
          </div>
        </section>

        </div>

        <section className="section">
          <p className="section__eyebrow">Why it works</p>
          <h2>Why MarkMePresent</h2>
          <p className="section__sub">Built so attendance can’t be faked by a friend, a forwarded code or a photo.</p>
          <div className="features__grid">
            <article className="feature">
              <span className="feature__icon"><FaUserShield /></span>
              <h3>College Google sign-in</h3>
              <p>Only verified NIT Jamshedpur accounts enter the system — no passwords to leak or forget.</p>
            </article>
            <article className="feature">
              <span className="feature__icon"><FaVolumeUp /></span>
              <h3>In-room presence</h3>
              <p>Presence is proven acoustically: the key tones only reach devices that are actually in the room.</p>
            </article>
            <article className="feature">
              <span className="feature__icon"><FaMobileAlt /></span>
              <h3>One device per student</h3>
              <p>Check-ins count only from the student’s own phone. A new phone is confirmed with a face check or by the teacher.</p>
            </article>
            <article className="feature">
              <span className="feature__icon"><FaFileCsv /></span>
              <h3>Rosters you already have</h3>
              <p>Paste or upload the class CSV once — attendance is matched to real roster identities.</p>
            </article>
          </div>
        </section>

        <section className="cta-wrap">
          <div className="cta">
            <h2>Ready when your class is.</h2>
            <p>Sign in with your NIT Jamshedpur account to continue.</p>
            <Link to="/login" className="ui-btn ui-btn--lg">Get started</Link>
          </div>
        </section>

        <footer className="footer">
          <div className="footer__inner">
            <span className="footer__note">© 2026 MarkMePresent · NIT Jamshedpur</span>
            <nav className="footer__links" aria-label="Footer">
              <Link to="/login">Sign in</Link>
              <Link to="/help">Help</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/acoustic-lab">Phone audio test</Link>
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}

export default Home;
