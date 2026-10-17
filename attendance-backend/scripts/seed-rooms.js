// Seed the standard classroom list: floors 1-3, rooms x01-x12
// (101-112, 201-212, 301-312). Safe to re-run: existing rooms are skipped.
//
// Usage: npm run seed:rooms
require("dotenv").config({ path: "./config/config.env" });
const mongoose = require("mongoose");
const { Room } = require("../models/roomModels");

const FLOORS = [1, 2, 3];
const ROOMS_PER_FLOOR = 12;

const standardRooms = () =>
  FLOORS.flatMap((floor) =>
    Array.from({ length: ROOMS_PER_FLOOR }, (_, index) => `${floor}${String(index + 1).padStart(2, "0")}`)
  );

(async () => {
  await mongoose.connect(process.env.DB_URI);

  let created = 0;
  for (const roomNo of standardRooms()) {
    const result = await Room.updateOne({ roomNo }, { $setOnInsert: { roomNo } }, { upsert: true });
    if (result.upsertedCount) created += 1;
  }

  console.log(`rooms created: ${created}, total rooms: ${await Room.countDocuments({})}`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
