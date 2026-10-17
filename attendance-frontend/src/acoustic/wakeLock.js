// Keeps the screen on while sending or listening; browsers pause audio when the
// screen locks. Re-acquires the lock when the tab becomes visible again.
export const keepScreenOn = async () => {
  let lock = null;
  const request = async () => {
    try {
      lock = await navigator.wakeLock?.request("screen");
    } catch {
      lock = null; // not supported or denied; the page still works with the screen kept on manually
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") request();
  };

  await request();
  document.addEventListener("visibilitychange", onVisibility);

  return {
    get active() {
      return Boolean(lock && !lock.released);
    },
    release: async () => {
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        await lock?.release();
      } catch {
        // already released
      }
    },
  };
};
