import React, { useEffect, useRef } from "react";
import Icon from "./Icon";

// Bottom sheet on phones, centred dialog from 640 px. Closes on Escape or a backdrop tap.
const Sheet = ({ title, subtitle, onClose, footer, children }) => {
  const panelRef = useRef(null);
  // Latest onClose without re-running the mount effect: callers often pass a new
  // function every render, and re-running it would pull focus out of inputs
  // (closing the phone keyboard on every keystroke).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus(); // once, when the sheet opens
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="ui-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="ui-sheet__backdrop" aria-label="Close" onClick={onClose} />
      <div className="ui-sheet__panel" ref={panelRef} tabIndex={-1}>
        <span className="ui-sheet__grip" aria-hidden="true" />
        <header className="ui-sheet__head">
          <div>
            <h2 className="ui-sheet__title">{title}</h2>
            {subtitle && <p className="ui-sheet__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
        </header>
        <div className="ui-sheet__body">{children}</div>
        {footer && <footer className="ui-sheet__foot">{footer}</footer>}
      </div>
    </div>
  );
};

export default Sheet;
