import React from "react";

// tones: indigo | emerald | amber | sky | rose. With onClick the whole card is a button.
const StatCard = ({ icon, label, value, hint, tone = "indigo", onClick }) => {
  const body = (
    <>
      <span className={`ui-stat__icon ui-stat__icon--${tone}`} aria-hidden="true">{icon}</span>
      <div>
        <div className="ui-stat__value">{value}</div>
        <div className="ui-stat__label">{label}</div>
        {hint && <div className="ui-stat__hint">{hint}</div>}
      </div>
    </>
  );
  return onClick ? (
    <button type="button" className="ui-stat ui-stat--action" onClick={onClick}>{body}</button>
  ) : (
    <div className="ui-stat">{body}</div>
  );
};

export default StatCard;
