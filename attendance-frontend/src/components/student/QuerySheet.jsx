import React, { useState } from "react";
import axios from "axios";
import SERVER_URL from "../../config/api";
import Button from "../../ui/Button";
import Sheet from "../../ui/Sheet";
import { untilLabel } from "../../utils/lockTime";
import { QUERY_REASONS } from "./attendanceText";

const MAX_TEXT = 300;

/**
 * Raise a query on an absent / in-review check-in (Phase 10): one per record,
 * until the check-in locks. The teacher sees it on their review card.
 * onDone(record) receives the updated record ({ status, reasons, query, canQuery }).
 */
const QuerySheet = ({ recordId, classLabel, lockAt, onDone, onClose }) => {
  const [reason, setReason] = useState(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const needsText = reason === "other" && !text.trim();

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await axios.post(`${SERVER_URL}/records/${recordId}/query`, { reason, text: text.trim() }, { withCredentials: true });
      onDone(response.data.record);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not send your query. Try again.");
      setSaving(false);
    }
  };

  const deadline = untilLabel(lockAt);

  return (
    <Sheet
      title="Raise a query"
      subtitle={`${classLabel ? `${classLabel} — ` : ""}your teacher will look at this check-in again. You can send one query${deadline ? `, ${deadline}` : ""}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving} disabled={!reason || needsText}>Send query</Button>
        </>
      }
    >
      <fieldset className="query-reasons">
        <legend className="ui-field__label">What happened?</legend>
        {QUERY_REASONS.map((option) => (
          <label key={option.id} className={`query-reason ${reason === option.id ? "is-selected" : ""}`}>
            <input type="radio" name="query-reason" value={option.id} checked={reason === option.id} onChange={() => setReason(option.id)} />
            <span>
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="query-text">
        <label className="ui-field__label" htmlFor="query-text">
          Details {reason === "other" ? "" : <span className="ui-muted">(optional)</span>}
        </label>
        <textarea
          id="query-text"
          className="ui-textarea"
          rows={3}
          maxLength={MAX_TEXT}
          placeholder="Where were you sitting? What did the screen say?"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <span className={`query-text__count ${text.length > MAX_TEXT - 30 ? "is-near" : ""}`}>{text.length}/{MAX_TEXT}</span>
      </div>
      {error && <p className="ui-field__error" role="alert">{error}</p>}
    </Sheet>
  );
};

export default QuerySheet;
