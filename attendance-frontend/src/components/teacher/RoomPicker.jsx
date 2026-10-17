import React, { useState } from "react";
import axios from "axios";
import SERVER_URL from "../../config/api";
import Button from "../../ui/Button";
import { groupRoomsByFloor } from "../../utils/rooms";

const OTHER_ROOM = "__other__";

// Room dropdown grouped by floor, with an "Other room…" escape hatch that
// creates a non-standard room (e.g. a lab) and selects it.
const RoomPicker = ({ id, rooms, value, onChange, onRoomCreated, required = false }) => {
  const [addingRoom, setAddingRoom] = useState(false);
  const [newRoomNo, setNewRoomNo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSelect = (event) => {
    if (event.target.value === OTHER_ROOM) {
      setAddingRoom(true);
      setError("");
      return;
    }
    onChange(event.target.value);
  };

  const createRoom = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await axios.post(`${SERVER_URL}/rooms`, { roomNo: newRoomNo }, { withCredentials: true });
      onRoomCreated(response.data.room);
      onChange(response.data.room._id);
      setAddingRoom(false);
      setNewRoomNo("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not add this room.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="room-picker">
      <select id={id} className="ui-input ui-select" value={value} onChange={handleSelect} required={required}>
        <option value="">Select a room</option>
        {groupRoomsByFloor(rooms).map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.rooms.map((room) => (
              <option key={room._id} value={room._id}>
                {room.roomNo}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={OTHER_ROOM}>+ Other room…</option>
      </select>

      {addingRoom && (
        <div className="room-picker__add">
          <input
            className="ui-input"
            value={newRoomNo}
            onChange={(event) => setNewRoomNo(event.target.value)}
            placeholder="e.g. CS Lab 2"
            maxLength={40}
            autoFocus
          />
          <Button size="sm" onClick={createRoom} loading={saving} disabled={!newRoomNo.trim()}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAddingRoom(false); setError(""); }}>
            Cancel
          </Button>
        </div>
      )}
      {error && <p className="ui-field__error">{error}</p>}
    </div>
  );
};

export default RoomPicker;
