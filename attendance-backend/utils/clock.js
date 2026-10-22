// Day boundaries in the college's time zone (default Asia/Kolkata).
const DEFAULT_TIMEZONE = "Asia/Kolkata";

const timeZone = () => process.env.TIMEZONE || DEFAULT_TIMEZONE;

// Wall-clock parts of `date` in `zone`.
const localParts = (date, zone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return parts;
};

// Last millisecond of the local day that contains `date`, as a UTC Date.
const endOfDay = (date = new Date(), zone = timeZone()) => {
  const parts = localParts(date, zone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMs = asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999) - offsetMs);
};

module.exports = { DEFAULT_TIMEZONE, timeZone, endOfDay };
