// Check-ins lock at 09:00 the next morning (Phase 10). Human labels for the lock time.

const SOON_MS = 3 * 60 * 60 * 1000;

const sameDay = (left, right) => left.toDateString() === right.toDateString();

// { soon: "1 h 20 min" } under 3 hours, else { day: "today" | "tomorrow" | "Mon", time: "09:00" }; null once locked.
const lockParts = (lockAt, now) => {
  if (!lockAt) return null;
  const at = new Date(lockAt);
  const left = at.getTime() - now;
  if (left <= 0) return null;
  if (left < SOON_MS) {
    const minutes = Math.max(1, Math.round(left / 60000));
    return { soon: minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min` };
  }
  const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
  return {
    day: sameDay(at, new Date(now)) ? "today" : sameDay(at, tomorrow) ? "tomorrow" : at.toLocaleDateString(undefined, { weekday: "short" }),
    time: at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
};

// "Locks in 1 h 20 min", "Locks tomorrow 09:00", "Locked".
export const lockLabel = (lockAt, now = Date.now()) => {
  if (!lockAt) return "";
  const parts = lockParts(lockAt, now);
  if (!parts) return "Locked";
  return parts.soon ? `Locks in ${parts.soon}` : `Locks ${parts.day} ${parts.time}`;
};

// "until 09:00 tomorrow" / "for 40 min" for deadlines inside sentences; "" once locked.
export const untilLabel = (lockAt, now = Date.now()) => {
  const parts = lockParts(lockAt, now);
  if (!parts) return "";
  return parts.soon ? `for ${parts.soon}` : `until ${parts.time} ${parts.day}`;
};

export const lockSoon = (lockAt, now = Date.now()) => Boolean(lockAt) && new Date(lockAt).getTime() - now < SOON_MS;

export const shortWhen = (value) =>
  value ? new Date(value).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
