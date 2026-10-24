import React from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";

/**
 * Page title block used by every signed-in page:
 * optional back link, eyebrow (e.g. course code), title, subtitle and actions.
 */
const PageHeader = ({ back, eyebrow, title, subtitle, actions, children }) => (
  <>
    {back && (
      <Link to={back.to} className="ui-page-head__back">
        <Icon name="back" />
        {back.label}
      </Link>
    )}
    <div className="ui-page-head">
      <div>
        {eyebrow && <p className="ui-page-head__eyebrow">{eyebrow}</p>}
        <h1 className="ui-page-head__title">{title}</h1>
        {subtitle && <p className="ui-page-head__sub">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="ui-page-head__actions">{actions}</div>}
    </div>
  </>
);

export default PageHeader;
