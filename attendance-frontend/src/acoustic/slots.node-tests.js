const test = require("node:test");
const assert = require("node:assert/strict");
const { upcomingSlots } = require("./slots");

test("slots: an on-time plan is used as given", () => {
  assert.deepEqual(upcomingSlots([10000, 12000, 14000], 8000), [10000, 12000, 14000]);
});

test("slots: a late plan skips past slots and keeps 3 repeats on the same 2 s grid", () => {
  assert.deepEqual(upcomingSlots([10000, 12000, 14000], 11000), [12000, 14000, 16000]);
  assert.deepEqual(upcomingSlots([10000, 12000, 14000], 15500), [16000, 18000, 20000]);
  // A slot starting within the minimum lead is too close to schedule; skip it.
  assert.deepEqual(upcomingSlots([10000, 12000, 14000], 9900), [12000, 14000, 16000]);
  upcomingSlots([10000, 12000, 14000], 15500).forEach((time) => assert.equal(time % 2000, 0));
});
