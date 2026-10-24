import React, { useEffect, useMemo, useState } from "react";
import Button from "../../ui/Button";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import { lockLabel, lockSoon, shortWhen } from "../../utils/lockTime";
import { FACE_LABEL, FacePair, QueryQuote, ReasonBadges, displayName } from "./recordParts";

const AttendanceCard = ({ record, selected, busy, onToggle, onDecide }) => {
  const [absentOpen, setAbsentOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <article className={`att-card ${selected ? "is-selected" : ""} ${record.query ? "att-card--query" : ""}`}>
      <label className="att-card__select">
        <input type="checkbox" checked={selected} onChange={() => onToggle(record._id)} />
        <span>Select</span>
      </label>
      <FacePair record={record} size="lg" />
      <div className="att-card__body">
        <strong className="att-card__name">{displayName(record)}</strong>
        <span className="ui-muted att-card__meta">
          {record.loginId || record.email}
          {record.wave ? ` · wave ${record.wave}` : ""}
          {record.face ? ` · ${FACE_LABEL[record.face.status] || record.face.status}` : ""}
          {typeof record.face?.similarity === "number" ? ` (${record.face.similarity.toFixed(0)})` : ""}
        </span>
        <ReasonBadges record={record} />
        <QueryQuote query={record.query} />
      </div>
      {absentOpen ? (
        <div className="att-card__absent">
          <input
            className="ui-input"
            placeholder="Optional note (kept in the audit log)"
            maxLength={300}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-label={`Note for marking ${displayName(record)} absent`}
          />
          <div className="att-card__actions">
            <Button variant="danger" disabled={busy} onClick={() => onDecide(record, "absent", note.trim())}>Confirm absent</Button>
            <Button variant="ghost" onClick={() => setAbsentOpen(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="att-card__actions">
          <Button disabled={busy} onClick={() => onDecide(record, "present", "")}>Mark present</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setAbsentOpen(true)}>Mark absent…</Button>
        </div>
      )}
    </article>
  );
};

/**
 * Reviews → Attendance (Phase 10): every review case of the teacher's
 * check-ins that are not locked yet, grouped by check-in, with checkboxes and a
 * sticky "Mark N present" bar for bulk decisions.
 */
const AttendanceReviews = ({ groups, busy, onDecide, onBulkPresent }) => {
  const [selected, setSelected] = useState(() => new Set());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Drop selections whose record is no longer waiting.
  const openIds = useMemo(() => new Set(groups.flatMap((group) => group.records.map((record) => record._id))), [groups]);
  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => openIds.has(id))));
  }, [openIds]);

  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleGroup = (group) =>
    setSelected((current) => {
      const ids = group.records.map((record) => record._id);
      const allIn = ids.every((id) => current.has(id));
      const next = new Set(current);
      ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
      return next;
    });

  if (groups.length === 0) {
    return <EmptyState icon="done" title="No attendance reviews" text="Unsure face checks, unheard phones and student queries appear here until the check-in locks at 09:00 the next morning." />;
  }

  return (
    <div className="att-reviews">
      {groups.map((group) => {
        const allSelected = group.records.every((record) => selected.has(record._id));
        const queries = group.records.filter((record) => record.query).length;
        return (
          <section key={group.session._id} className="att-group">
            <header className="att-group__head">
              <div className="att-group__title">
                <strong>{group.class ? `${group.class.courseCode}${group.class.section ? ` · ${group.class.section}` : ""}` : "Check-in"}</strong>
                <span className="ui-muted">
                  {shortWhen(group.session.startedAt)} · {group.records.length} to review{queries ? ` · ${queries} with a query` : ""}
                </span>
              </div>
              <span className={`lock-chip ${lockSoon(group.session.lockAt, now) ? "lock-chip--soon" : ""}`}><Icon name="lock" size={13} /> {lockLabel(group.session.lockAt, now)}</span>
              <Button variant="ghost" size="sm" onClick={() => toggleGroup(group)}>{allSelected ? "Clear" : "Select all"}</Button>
            </header>
            <div className="att-card-list">
              {group.records.map((record) => (
                <AttendanceCard key={record._id} record={record} selected={selected.has(record._id)} busy={busy} onToggle={toggle} onDecide={onDecide} />
              ))}
            </div>
          </section>
        );
      })}

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk decision">
          <span><strong>{selected.size}</strong> selected</span>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          <Button loading={busy} onClick={() => onBulkPresent([...selected])}>Mark {selected.size} present</Button>
        </div>
      )}
    </div>
  );
};

export default AttendanceReviews;
