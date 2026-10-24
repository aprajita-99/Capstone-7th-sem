import React from "react";
import Icon from "./Icon";

// `icon` is an Icon name (e.g. "inbox"); any other node is rendered as given.
const EmptyState = ({ icon, title, text, action }) => (
  <div className="ui-empty">
    {icon && <span className="ui-empty__icon" aria-hidden="true">{typeof icon === "string" ? <Icon name={icon} /> : icon}</span>}
    <h3 className="ui-empty__title">{title}</h3>
    {text && <p className="ui-empty__text">{text}</p>}
    {action && <div className="ui-empty__action">{action}</div>}
  </div>
);

export default EmptyState;
