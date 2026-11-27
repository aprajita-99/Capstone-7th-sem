import { useEffect, useRef } from "react";

/**
 * Keeps a page's data current without a manual refresh:
 * runs `refresh` now, every `intervalMs` while the tab is visible, and right
 * away when the user comes back to the tab/app or the network returns
 * (phones pause timers while the screen is off or the browser is in the background).
 * Calls closer than 1.5 s apart are merged.
 */
const useLiveRefresh = (refresh, intervalMs, enabled = true) => {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (!enabled) return undefined;
    let lastRun = 0;
    const run = () => {
      const now = Date.now();
      if (now - lastRun < 1500) return;
      lastRun = now;
      latest.current();
    };
    const onReturn = () => {
      if (document.visibilityState !== "hidden") run();
    };

    run();
    const timer = window.setInterval(onReturn, intervalMs);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onReturn);
    window.addEventListener("pageshow", onReturn); // back/forward cache
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onReturn);
      window.removeEventListener("pageshow", onReturn);
    };
  }, [enabled, intervalMs]);
};

export default useLiveRefresh;
