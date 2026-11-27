/**
 * Development mode (DEV_MODE=true in the environment), for testing with
 * accounts that have no college ID card and with several phones.
 *
 * While it is on, for every student:
 *  - the identity check skips the ID card: a live selfie (AWS liveness) alone
 *    verifies the student and becomes the reference face for check-ins;
 *  - the one-phone rule is off: every browser the student signs in on is
 *    trusted at once (no teacher review, no face approval of a new phone).
 *
 * Turn it off for the real pilot. Read on every call so tests and config
 * reloads always see the current value.
 */
const ON_VALUES = new Set(["1", "true", "yes", "on"]);

const isDevMode = () => ON_VALUES.has(String(process.env.DEV_MODE || "").trim().toLowerCase());

// Extra phones remembered per student in dev mode (oldest dropped beyond this).
const MAX_DEV_DEVICES = 10;

module.exports = { isDevMode, MAX_DEV_DEVICES };
