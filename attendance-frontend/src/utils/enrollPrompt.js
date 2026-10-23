// "Later" on the identity wizard is remembered for this browser session only,
// so the wizard does not reopen on every sign-in until the student is ready.
const ENROLL_LATER_KEY = "bio-attend-enroll-later";

export const postponeEnrollment = () => {
  try {
    sessionStorage.setItem(ENROLL_LATER_KEY, "1");
  } catch {
    // storage blocked: the dashboard card still offers enrollment
  }
};

export const enrollmentPostponed = () => {
  try {
    return sessionStorage.getItem(ENROLL_LATER_KEY) === "1";
  } catch {
    return false;
  }
};
