import React, { useEffect, useMemo, useRef, useState } from "react";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import EmptyState from "../../ui/EmptyState";
import { DECISION_LABEL, FACE_LABEL, FacePair, QUERY_REASON_LABEL, QueryQuote, ReasonBadges, STATUS_BADGE, displayName, time } from "./recordParts";

const TABS = [
  { id: "review", label: "Review", match: (record) => record.status === "review" },
  { id: "present", label: "Present", match: (record) => record.status === "present" },
  { id: "listening", label: "Listening", match: (record) => ["joined", "heard"].includes(record.status) },
  { id: "absent", label: "Absent", match: (record) => record.status === "absent" },
];

const ReviewCard = ({ record, locked, busy, onDecide, onOpen }) => {
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  return (
    <article className="review-card">
      <button type="button" className="review-card__photos" onClick={() => onOpen(record)} aria-label={`Open ${displayName(record)}`}>
        <FacePair record={record} />
      </button>
      <div className="review-card__body">
        <strong className="review-card__name">{displayName(record)}</strong>
        <span className="ui-muted review-card__meta">{record.loginId || record.email}{record.wave ? ` · wave ${record.wave}` : ""}</span>
        <ReasonBadges record={record} />
        {record.face && (
          <span className="ui-muted review-card__meta">
            {FACE_LABEL[record.face.status] || record.face.status}
            {typeof record.face.similarity === "number" ? ` · similarity ${record.face.similarity.toFixed(0)}` : ""}
            {record.face.attempts ? ` · ${record.face.attempts} attempt${record.face.attempts > 1 ? "s" : ""}` : ""}
          </span>
        )}
        <QueryQuote query={record.query} />
        {locked ? (
          <Badge variant="neutral">Locked — decisions closed at 09:00</Badge>
        ) : (
          <>
            {showNote && (
              <input className="ui-input review-card__note" placeholder="Optional note (kept in the audit log)" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
            )}
            <div className="review-card__actions">
              <Button size="sm" disabled={busy} onClick={() => onDecide(record, "present", note)}>Mark present</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(record, "absent", note)}>Mark absent</Button>
              {!showNote && <Button size="sm" variant="ghost" onClick={() => setShowNote(true)}>Add note</Button>}
            </div>
          </>
        )}
      </div>
    </article>
  );
};

// Present ↔ absent override (Phase 10): the teacher must say why; audited, student sees "changed by teacher".
const OverrideForm = ({ record, busy, onDecide }) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const target = record.status === "present" ? "absent" : "present";
  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Change to {target}…
      </Button>
    );
  }
  return (
    <div className="override-form">
      <label className="ui-field__label" htmlFor={`override-${record._id}`}>Why are you changing this to {target}?</label>
      <textarea
        id={`override-${record._id}`}
        className="ui-textarea override-form__note"
        rows={2}
        maxLength={300}
        placeholder={target === "absent" ? "e.g. Spot-check: not in the room" : "e.g. Phone broken, seen in class"}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="review-card__actions">
        <Button size="sm" variant={target === "absent" ? "danger" : "primary"} disabled={busy || !note.trim()} onClick={() => onDecide(record, target, note.trim())}>
          Mark {target}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <p className="ui-muted student-panel__note">Kept in the audit log. The student sees “changed by your teacher”, not your note.</p>
    </div>
  );
};

const StudentPanel = ({ record, locked, busy, onDecide, onClose }) => {
  const badge = STATUS_BADGE[record.status] || STATUS_BADGE.absent;
  const steps = [
    { label: "Joined", at: record.joinedAt },
    { label: record.wave ? `Heard the key (wave ${record.wave})` : "Heard the key", at: record.heardAt },
    record.face ? { label: `${FACE_LABEL[record.face.status] || record.face.status}${typeof record.face.similarity === "number" ? ` (${record.face.similarity.toFixed(0)})` : ""}`, at: record.face.checkedAt } : null,
    record.relayedAt ? { label: "Relayed the key", at: record.relayedAt } : null,
    record.query ? { label: `Student query: ${QUERY_REASON_LABEL[record.query.reason] || record.query.reason}`, at: record.query.raisedAt } : null,
    record.decision
      ? { label: `${record.decision.kind === "lock" ? "Locked undecided →" : `${DECISION_LABEL[record.decision.kind] || "Teacher"}:`} ${record.decision.status}${record.decision.note ? ` — “${record.decision.note}”` : ""}`, at: record.decision.at }
      : null,
  ].filter((step) => step && step.at);
  const canOverride = !locked && ["present", "absent"].includes(record.status) && onDecide;
  return (
    <div className="student-panel" role="dialog" aria-modal="true" aria-label={displayName(record)}>
      <button type="button" className="student-panel__backdrop" aria-label="Close" onClick={onClose} />
      <aside className="student-panel__sheet">
        <header className="student-panel__head">
          <div>
            <strong>{displayName(record)}</strong>
            <span className="ui-muted">{record.email}</span>
          </div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <Badge variant={badge.variant} dot>{badge.label}</Badge>
        <ReasonBadges record={record} />
        <FacePair record={record} size="lg" />
        <QueryQuote query={record.query} />
        <ol className="student-panel__timeline">
          {steps.length === 0 ? <li className="ui-muted">No activity yet.</li> : steps.map((step) => (
            <li key={step.label}><span>{time(step.at)}</span>{step.label}</li>
          ))}
        </ol>
        {canOverride && <OverrideForm key={`${record._id}-${record.status}`} record={record} busy={busy} onDecide={onDecide} />}
        <p className="ui-muted student-panel__note">Check-in frames are deleted when the check-in locks (09:00 the next morning).</p>
      </aside>
    </div>
  );
};

/**
 * Student list for a check-in (live or closed): tabs, search, review cards
 * with frames and same-day decisions, and a side panel per student.
 */
const CheckinStudents = ({ records = [], locked, busy, onDecide, initialStudent = null }) => {
  const reviewCount = records.filter(TABS[0].match).length;
  const [tab, setTab] = useState(null);
  const [query, setQuery] = useState("");
  const [openRecord, setOpenRecord] = useState(null);
  const appliedInitial = useRef(false);

  // Opened from the class attendance grid (?student=email): show that student's panel once.
  useEffect(() => {
    if (!initialStudent || appliedInitial.current) return;
    const match = records.find((record) => record.email === initialStudent);
    if (!match) return;
    appliedInitial.current = true;
    setTab(TABS.find((item) => item.match(match))?.id || null);
    setOpenRecord(match);
  }, [initialStudent, records]);
  const activeTab = tab || (reviewCount > 0 ? "review" : "present");

  const visible = useMemo(() => {
    const matcher = TABS.find((item) => item.id === activeTab).match;
    const search = query.trim().toLowerCase();
    return records
      .filter(matcher)
      .filter((record) => !search || `${record.name} ${record.email} ${record.loginId} ${record.rollNumber}`.toLowerCase().includes(search))
      .sort((left, right) => displayName(left).localeCompare(displayName(right)));
  }, [records, activeTab, query]);

  const current = openRecord ? records.find((record) => record._id === openRecord._id) || openRecord : null;

  return (
    <div className="checkin-students">
      <div className="checkin-students__bar">
        <div className="review-tabs" role="tablist">
          {TABS.map((item) => {
            const count = records.filter(item.match).length;
            return (
              <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id} className={activeTab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
                {item.label} <Badge variant={item.id === "review" && count ? "warning" : "neutral"}>{count}</Badge>
              </button>
            );
          })}
        </div>
        <input className="ui-input checkin-students__search" placeholder="Search name, email or roll" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search students" />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={activeTab === "review" ? "✓" : "👂"}
          title={query ? "No matches" : activeTab === "review" ? "Nothing to review" : "Nobody here yet"}
          text={query ? "Try a different name or roll number." : activeTab === "review" ? "Unsure face checks and unheard phones appear here." : "Students appear as they join and check in."}
        />
      ) : activeTab === "review" ? (
        <div className="review-card-list">
          {visible.map((record) => (
            <ReviewCard key={record._id} record={record} locked={locked} busy={busy} onDecide={onDecide} onOpen={setOpenRecord} />
          ))}
        </div>
      ) : (
        <ul className="checkin-names">
          {visible.map((record) => {
            const badge = STATUS_BADGE[record.status] || STATUS_BADGE.absent;
            return (
              <li key={record._id}>
                <button type="button" className="checkin-name checkin-name--button" onClick={() => setOpenRecord(record)}>
                  <span className="checkin-name__who">
                    <strong>{displayName(record)}</strong>
                    <span>
                      {record.loginId || record.email}
                      {record.wave ? ` · wave ${record.wave}` : ""}
                      {record.face ? ` · ${FACE_LABEL[record.face.status] || record.face.status}` : ""}
                      {record.decision ? ` · ${(DECISION_LABEL[record.decision.kind] || "decided by teacher").toLowerCase()}` : ""}
                    </span>
                  </span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {current && <StudentPanel record={current} locked={locked} busy={busy} onDecide={onDecide} onClose={() => setOpenRecord(null)} />}
    </div>
  );
};

export default CheckinStudents;
