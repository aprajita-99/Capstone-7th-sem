import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import Navbar from "../Navbar/navbar";
import "./info.css";

// Shared layout for the public text pages (Privacy, Help): navbar, title, content, footer.
const InfoLayout = ({ title, subtitle, children }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <Navbar />
      <main className="info">
        <header className="info__head">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </header>
        {children}
      </main>
      <footer className="footer">
        <div className="footer__inner info-footer">
          <span className="footer__note">© 2026 MarkMePresent · NIT Jamshedpur</span>
          <nav className="footer__links" aria-label="Footer">
            <Link to="/">Home</Link>
            <Link to="/help">Help</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/login">Sign in</Link>
          </nav>
        </div>
      </footer>
    </>
  );
};

export default InfoLayout;
