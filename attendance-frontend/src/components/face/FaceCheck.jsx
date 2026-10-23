import React, { useEffect, useState } from "react";
import axios from "axios";
import { ThemeProvider } from "@aws-amplify/ui-react";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";
import "@aws-amplify/ui-react/styles.css";
import SERVER_URL from "../../config/api";
import { AWS_REGION, configureAmplify, faceCheckAvailable } from "../../face/amplify";
import Button from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import "./faceCheck.css";

/**
 * Shared AWS Face Liveness step (Phases 7–9).
 * 1. asks our backend to create a liveness session for `purpose`,
 * 2. runs AWS's FaceLivenessDetector (short guided selfie video, streamed to AWS),
 * 3. calls onFinished(livenessSessionId); the caller asks the backend for the result.
 * The phone never decides "live" or "match" itself.
 */
const FaceCheck = ({ purpose, extra = {}, onFinished, onCancel }) => {
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSessionId(null);
    setError("");
    if (!faceCheckAvailable()) {
      setError("Face checks are not set up on this site yet (missing identity pool).");
      return undefined;
    }
    configureAmplify();
    axios
      .post(`${SERVER_URL}/face/liveness-session`, { purpose, ...extra }, { withCredentials: true })
      .then((response) => {
        if (!cancelled) setSessionId(response.data.livenessSessionId);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.response?.data?.message || "Could not start the face check.");
      });
    return () => {
      cancelled = true;
    };
    // extra is a plain object from the caller; re-run only when the purpose or attempt changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purpose, attempt]);

  if (error) {
    return (
      <div className="face-check face-check--message">
        <p className="ui-field__error">{error}</p>
        <div className="face-check__actions">
          <Button variant="secondary" onClick={() => setAttempt((count) => count + 1)}>Try again</Button>
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="face-check face-check--message">
        <Spinner /> <span>Preparing the camera check…</span>
      </div>
    );
  }

  return (
    <div className="face-check">
      <ThemeProvider>
        <FaceLivenessDetector
          key={sessionId}
          sessionId={sessionId}
          region={AWS_REGION}
          onAnalysisComplete={async () => onFinished(sessionId)}
          onUserCancel={() => (onCancel ? onCancel() : setAttempt((count) => count + 1))}
          onError={(livenessError) => {
            const message = livenessError?.error?.message || livenessError?.state || "The camera check stopped.";
            setError(`${message} Make sure the camera is allowed and your face is well lit.`);
          }}
        />
      </ThemeProvider>
    </div>
  );
};

export default FaceCheck;
