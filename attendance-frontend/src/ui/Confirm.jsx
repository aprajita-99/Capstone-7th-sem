import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import Button from "./Button";
import Sheet from "./Sheet";

const ConfirmContext = createContext(null);

/**
 * In-app replacement for window.confirm: `await confirm({ title, message, confirmLabel })`
 * resolves true (confirmed) or false (cancelled, backdrop, Escape).
 */
export const ConfirmProvider = ({ children }) => {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolverRef.current?.(false); // a previous dialog still open counts as cancelled
        resolverRef.current = resolve;
        setRequest(options);
      }),
    []
  );

  const finish = useCallback((answer) => {
    resolverRef.current?.(answer);
    resolverRef.current = null;
    setRequest(null);
  }, []);
  const cancel = useCallback(() => finish(false), [finish]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Sheet
          title={request.title || "Are you sure?"}
          onClose={cancel}
          footer={
            <>
              <Button variant="secondary" onClick={cancel}>{request.cancelLabel || "Cancel"}</Button>
              <Button variant={request.tone === "primary" ? "primary" : "danger"} onClick={() => finish(true)}>
                {request.confirmLabel || "Confirm"}
              </Button>
            </>
          }
        >
          <p className="ui-confirm__text">{request.message}</p>
        </Sheet>
      )}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
};
