import React from "react";

export const Spinner = ({ large = false }) => (
  <span className={`ui-spinner ${large ? "ui-spinner--lg" : ""}`} role="status" aria-label="Loading" />
);

export const Skeleton = ({ height = 16, width = "100%", card = false }) => (
  <span className={`ui-skeleton ${card ? "ui-skeleton--card" : ""}`} style={{ height, width }} aria-hidden="true" />
);

// Full-page placeholder while a page loads: a page-shaped skeleton instead of a lone spinner.
export const PageLoader = ({ label = "Loading…" }) => (
  <div className="ui-page-loader" role="status" aria-live="polite">
    <div className="ui-page-loader__bar" />
    <div className="ui-page-loader__body">
      <Skeleton height={14} width="120px" />
      <Skeleton height={30} width="min(320px, 70%)" />
      <Skeleton height={150} card />
      <Skeleton height={110} card />
      <Skeleton height={110} card />
    </div>
    <span className="ui-page-loader__label">{label}</span>
  </div>
);

export default Spinner;
