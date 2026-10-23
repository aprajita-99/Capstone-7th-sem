/**
 * Relay slot times (server-clock ms). Slot boundaries are global multiples of
 * slotMs, so a phone that receives its plan late can skip the slots already
 * past and use the next boundaries instead, and still play in step with the
 * other phones of its wave. Plain CommonJS so Node tests can use it.
 */
const upcomingSlots = (playAt, serverNowMs, slotMs = 2000, count = playAt.length || 3, minLeadMs = 250) => {
  const future = playAt.filter((time) => time >= serverNowMs + minLeadMs);
  let next = future.length ? future[future.length - 1] + slotMs : Math.ceil((serverNowMs + minLeadMs) / slotMs) * slotMs;
  while (future.length < count) {
    future.push(next);
    next += slotMs;
  }
  return future.slice(0, count);
};

module.exports = { upcomingSlots };
