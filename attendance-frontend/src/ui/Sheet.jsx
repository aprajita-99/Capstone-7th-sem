import React, { useEffect, useRef } from "react";

// Bottom sheet on phones, centred dialog from 640 px. Closes on Escape or a backdrop tap.
const Sheet = ({ title, subtitle, onClose, footer, children }) => {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

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
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="ui-sheet__body">{children}</div>
        {footer && <footer className="ui-sheet__foot">{footer}</footer>}
      </div>
    </div>
  );
};

export default Sheet;
