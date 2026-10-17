// Standard rooms are three digits; the first digit is the floor (101 → first floor).
const FLOOR_NAMES = { 1: "First floor", 2: "Second floor", 3: "Third floor" };

const floorOf = (roomNo) => {
  const match = /^([1-9])\d{2}$/.exec(String(roomNo || "").trim());
  return match ? Number(match[1]) : null;
};

// [{ label, rooms }] ordered by floor, with any non-standard rooms last.
export const groupRoomsByFloor = (rooms) => {
  const groups = new Map();
  const others = [];

  [...rooms]
    .sort((left, right) => String(left.roomNo).localeCompare(String(right.roomNo), undefined, { numeric: true }))
    .forEach((room) => {
      const floor = floorOf(room.roomNo);
      if (floor === null) {
        others.push(room);
        return;
      }
      if (!groups.has(floor)) groups.set(floor, []);
      groups.get(floor).push(room);
    });

  const floors = [...groups.keys()].sort((left, right) => left - right).map((floor) => ({
    label: FLOOR_NAMES[floor] || `Floor ${floor}`,
    rooms: groups.get(floor),
  }));

  return others.length > 0 ? [...floors, { label: "Other rooms", rooms: others }] : floors;
};

export const roomLabel = (room) => {
  if (!room?.roomNo) return "No room";
  const floor = floorOf(room.roomNo);
  return floor ? `Room ${room.roomNo} · ${FLOOR_NAMES[floor] || `Floor ${floor}`}` : room.roomNo;
};
