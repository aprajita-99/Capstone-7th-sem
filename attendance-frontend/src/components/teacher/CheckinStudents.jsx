import React, { useMemo, useState } from "react";
import SERVER_URL from "../../config/api";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import EmptyState from "../../ui/EmptyState";

const frameUrl = (recordId) => `${SERVER_URL}/evidence/${recordId}/frame`;
const mediaUrl = (mediaId) => `${SERVER_URL}/media/${mediaId}`;

const STATUS_BADGE = {
  present: { variant: "success", label: "Present" },
  joined: { variant: "info", label: "Listening" },
  heard: { variant: "info", label: "Face check" },
  review: { variant: "warning", label: "Review" },
  absent: { variant: "neutral", label: "Absent" },
};

const REASON_LABEL = {
  not_heard: "Not heard",
  face_mismatch: "Face doesn't match",
  face_unsure: "Face unsure",
  face_not_live: "Not a live face",
  face_missing: "No face check",
  device_unverified: "Phone not verified",
  not_joined: "Did not join",
};

const FACE_LABEL = {
  passed: "Face matched",
  unsure: "Face unsure",
  mismatch: "Face mismatch",
  not_live: "Not live",
  missing: "No face check",
};

const TABS = [
  { id: "review", label: "Review", match: (record) => record.status === "review" },
  { id: "present", label: "Present", match: (record) => record.status === "present" },
  { id: "listening", label: "Listening", match: (record) => ["joined", "heard"].includes(record.status) },
  { id: "absent", label: "Absent", match: (record) => record.status === "absent" },
];

const displayName = (record) => record.name || record.email.split("@")[0];
const time = (value) => (value ? new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null);

const FacePair = ({ record, size = "md" }) => (
  <div className={`face-pair face-pair--${size}`}>
    <figure>
      {record.hasFrame ? <img src={frameUrl(record._id)} alt={`Check-in frame of ${displayName(record)}`} loading="lazy" /> : <span className="face-pair__empty">No frame</span>}
      <figcaption>Check-in</figcaption>
    </figure>
    <figure>
      {record.referenceFaceMedia ? <img src={mediaUrl(record.referenceFaceMedia)} alt={`Enrolled face of ${displayName(record)}`} loading="lazy" /> : <span className="face-pair__empty">Not enrolled</span>}
      <figcaption>Enrolled</figcaption>
    </figure>
  </div>
);

const ReasonBadges = ({ record }) => (
  <span className="reason-badges">
    {(record.reasons || []).map((reason) => <Badge key={reason} variant="warning">{REASON_LABEL[reason] || reason}</Badge>)}
    {record.decision && <Badge variant="info">Decided by teacher</Badge>}
  </span>
);

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
        {locked ? (
          <Badge variant="neutral">Locked — decisions close at midnight</Badge>
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

const StudentPanel = ({ record, onClose }) => {
  const badge = STATUS_BADGE[record.status] || STATUS_BADGE.absent;
  const steps = [
    { label: "Joined", at: record.joinedAt },
    { label: record.wave ? `Heard the key (wave ${record.wave})` : "Heard the key", at: record.heardAt },
    record.face ? { label: `${FACE_LABEL[record.face.status] || record.face.status}${typeof record.face.similarity === "number" ? ` (${record.face.similarity.toFixed(0)})` : ""}`, at: record.face.checkedAt } : null,
    record.relayedAt ? { label: "Relayed the key", at: record.relayedAt } : null,
    record.decision ? { label: `Teacher marked ${record.decision.status}${record.decision.note ? ` — “${record.decision.note}”` : ""}`, at: record.decision.at } : null,
  ].filter((step) => step && step.at);
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
        <ol className="student-panel__timeline">
          {steps.length === 0 ? <li className="ui-muted">No activity yet.</li> : steps.map((step) => (
            <li key={step.label}><span>{time(step.at)}</span>{step.label}</li>
          ))}
        </ol>
        <p className="ui-muted student-panel__note">Check-in frames are deleted after 24 hours.</p>
      </aside>
    </div>
  );
};

/**
 * Student list for a check-in (live or closed): tabs, search, review cards
 * with frames and same-day decisions, and a side panel per student.
 */
const CheckinStudents = ({ records = [], locked, busy, onDecide }) => {
  const reviewCount = records.filter(TABS[0].match).length;
  const [tab, setTab] = useState(null);
  const [query, setQuery] = useState("");
  const [openRecord, setOpenRecord] = useState(null);
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
                      {record.decision ? " · decided by teacher" : ""}
                    </span>
                  </span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {current && <StudentPanel record={current} onClose={() => setOpenRecord(null)} />}
    </div>
  );
};

export default CheckinStudents;
