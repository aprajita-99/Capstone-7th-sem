import React from "react";
import { Link } from "react-router-dom";

// The MarkMePresent mark: a check whose tail turns into sound waves ("marked present by sound").
// Same drawing as public/logo.svg (favicon / app icon).
export const BrandMark = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.2 12.4 7.9 16.1 13.6 8.6" />
    <path d="M15.9 10a3.4 3.4 0 0 1 0 4.8" />
    <path d="M18.5 7.6a6.8 6.8 0 0 1 0 9.6" />
  </svg>
);

// Navy brand tile + wordmark, shared by the public navbar and the app shell.
const Brand = ({ to = "/" }) => (
  <Link to={to} className="ui-brand">
    <span className="ui-brand__mark" aria-hidden="true">
      <BrandMark size={20} />
    </span>
    <span className="ui-brand__name">
      MarkMe<em>Present</em>
    </span>
  </Link>
);

export default Brand;
