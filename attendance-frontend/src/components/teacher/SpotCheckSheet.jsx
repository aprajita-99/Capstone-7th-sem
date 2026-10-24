import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import SERVER_URL from "../../config/api";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import EmptyState from "../../ui/EmptyState";
import Sheet from "../../ui/Sheet";
import Spinner from "../../ui/Spinner";
import { FacePair, displayName } from "./recordParts";

const SPOT_NOTE = "Spot-check: not in the room";

/**
 * Spot-check (Phase 10): 5 random present students to call out by name.
 * "Here" ticks them off; "Not here" marks them absent (an audited override).
 */
const SpotCheckSheet = ({ sessionId, locked, onDecide, onClose }) => {
  const [records, setRecords] = useState(null);
  const [marks, setMarks] = useState({}); // recordId → "here" | "absent"
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setRecords(null);
    setMarks({});
    setError("");
    try {
      const response = await axios.get(`${SERVER_URL}/sessions/${sessionId}/spot-check?n=5`, { withCredentials: true });
      setRecords(response.data.records);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not pick students.");
      setRecords([]);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const notHere = async (record) => {
    setBusyId(record._id);
    const ok = await onDecide(record, "absent", SPOT_NOTE);
    if (ok) setMarks((current) => ({ ...current, [record._id]: "absent" }));
    setBusyId(null);
  };

  const checked = Object.keys(marks).length;

  return (
    <Sheet
      title="Spot-check"
      subtitle="Call out these names. Tap “Here” when they answer; “Not here” marks them absent (kept in the audit log)."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={load} disabled={records === null || Boolean(busyId)}>Pick 5 others</Button>
          <Button onClick={onClose}>Done{checked ? ` (${checked} checked)` : ""}</Button>
        </>
      }
    >
      {records === null ? (
        <div className="att-loading"><Spinner /> <span className="ui-muted">Picking students…</span></div>
      ) : records.length === 0 ? (
        <EmptyState icon="👀" title={error ? "Spot-check unavailable" : "Nobody present yet"} text={error || "Students appear here once they are marked present."} />
      ) : (
        <ul className="spot-list">
          {records.map((record) => {
            const mark = marks[record._id];
            return (
              <li key={record._id} className={`spot-row ${mark ? `spot-row--${mark}` : ""}`}>
                <FacePair record={record} size="sm" />
                <div className="spot-row__who">
                  <strong>{displayName(record)}</strong>
                  <span className="ui-muted">{record.loginId || record.email}{record.wave ? ` · wave ${record.wave}` : ""}</span>
                  {mark === "here" && <Badge variant="success" dot>Here</Badge>}
                  {mark === "absent" && <Badge variant="danger" dot>Marked absent</Badge>}
                </div>
                {!mark && (
                  <div className="spot-row__actions">
                    <Button size="sm" variant="soft" onClick={() => setMarks((current) => ({ ...current, [record._id]: "here" }))}>Here ✓</Button>
                    {!locked && (
                      <Button size="sm" variant="secondary" loading={busyId === record._id} disabled={Boolean(busyId)} onClick={() => notHere(record)}>
                        Not here
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
};

export default SpotCheckSheet;
