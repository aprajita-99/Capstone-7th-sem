import React from "react";
import SERVER_URL from "../../config/api";
import Badge from "../../ui/Badge";

// Shared pieces for attendance records on the live / summary page, Reviews and spot-check.

export const frameUrl = (recordId) => `${SERVER_URL}/evidence/${recordId}/frame`;
export const mediaUrl = (mediaId) => `${SERVER_URL}/media/${mediaId}`;

export const STATUS_BADGE = {
  present: { variant: "success", label: "Present" },
  joined: { variant: "info", label: "Listening" },
  heard: { variant: "info", label: "Face check" },
  review: { variant: "warning", label: "Review" },
  absent: { variant: "neutral", label: "Absent" },
};

export const REASON_LABEL = {
  not_heard: "Not heard",
  face_mismatch: "Face doesn't match",
  face_unsure: "Face unsure",
  face_not_live: "Not a live face",
  face_missing: "No face check",
  device_unverified: "Phone not verified",
  not_joined: "Did not join",
  student_query: "Student query",
  unresolved: "Not decided before the lock",
};

export const FACE_LABEL = {
  passed: "Face matched",
  unsure: "Face unsure",
  mismatch: "Face mismatch",
  not_live: "Not live",
  missing: "No face check",
};

export const QUERY_REASON_LABEL = {
  cant_hear: "My phone couldn't hear the key",
  camera_failed: "The camera / face check failed",
  was_present: "I was in class",
  other: "Something else",
};

export const DECISION_LABEL = {
  review: "Decided by teacher",
  query: "Query answered",
  override: "Changed by teacher",
  lock: "Auto-closed at lock",
};

export const displayName = (record) => record.name || record.email.split("@")[0];

export const time = (value) => (value ? new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null);

export const FacePair = ({ record, size = "md" }) => (
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

export const ReasonBadges = ({ record }) => (
  <span className="reason-badges">
    {(record.reasons || []).map((reason) => <Badge key={reason} variant={reason === "student_query" ? "info" : "warning"}>{REASON_LABEL[reason] || reason}</Badge>)}
    {record.decision && <Badge variant="info">{DECISION_LABEL[record.decision.kind] || "Decided by teacher"}</Badge>}
  </span>
);

// The student's own words on a review card.
export const QueryQuote = ({ query }) =>
  query ? (
    <blockquote className="query-quote">
      <strong>{QUERY_REASON_LABEL[query.reason] || "Student query"}</strong>
      {query.text && <span>“{query.text}”</span>}
      <cite>Student query · {time(query.raisedAt)}</cite>
    </blockquote>
  ) : null;
