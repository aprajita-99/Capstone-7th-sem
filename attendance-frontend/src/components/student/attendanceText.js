// Plain-language wording for a student's own attendance records (check-in screen + dashboard).

export const REASON_TEXT = {
  not_heard: "your phone joined but did not hear the key",
  face_mismatch: "the face in the check did not match your enrolled photo",
  face_unsure: "the face match was not certain (often poor light)",
  face_not_live: "the camera check did not look like a live person",
  face_missing: "the face check was not completed in time",
  not_joined: "you did not join this check-in",
  student_query: "you raised a query",
};

export const explain = (reasons = []) =>
  reasons
    .filter((reason) => reason !== "unresolved")
    .map((reason) => REASON_TEXT[reason] || reason)
    .join("; ");

export const QUERY_REASONS = [
  { id: "cant_hear", label: "My phone couldn't hear the key", hint: "e.g. weak mic, phone in a case" },
  { id: "camera_failed", label: "The camera / face check failed", hint: "e.g. dark room, camera wouldn't open" },
  { id: "was_present", label: "I was in class", hint: "e.g. forgot to join in time" },
  { id: "other", label: "Something else", hint: "tell your teacher what happened" },
];

export const queryReasonLabel = (id) => QUERY_REASONS.find((reason) => reason.id === id)?.label || "Query";

// One line under the status: who decided, or why it is still open.
export const decisionText = (record) => {
  const decision = record?.decision;
  if (!decision) return null;
  if (decision.kind === "lock") return "Not reviewed before the check-in locked, so it was marked absent.";
  if (decision.kind === "override") return "Changed by your teacher.";
  if (decision.kind === "query") return "Your teacher answered your query.";
  return "Decided by your teacher.";
};
