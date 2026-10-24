import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import { fetchSessionUser } from "../../utils/session";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import PageHeader from "../../ui/PageHeader";
import { PageLoader, Spinner } from "../../ui/Spinner";
import { teacherLinks } from "../teacher/teacherSession";
import { studentLinks } from "../student/studentLinks";
import FaceCheck from "./FaceCheck";
import "./faceCheck.css";

const requestConfig = { withCredentials: true };

const VERDICT = {
  live: { variant: "success", label: "Live person" },
  not_live: { variant: "danger", label: "Not live (photo / screen / mask?)" },
  failed: { variant: "danger", label: "Check did not complete" },
};

const MATCH = {
  match: { variant: "success", label: "Same person" },
  unsure: { variant: "warning", label: "Unsure — would go to teacher review" },
  no_match: { variant: "danger", label: "Different person" },
};

/**
 * Phase 7 self-test: run AWS Face Liveness on this phone and see the server's
 * verdict; run it a second time (same or different person) to see CompareFaces.
 */
const FaceTest = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [stage, setStage] = useState("idle"); // idle | checking | reading | done
  const [results, setResults] = useState([]); // [{ sessionId, ...result }]
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSessionUser()
      .then((response) => setUser(response.data.user))
      .catch(() => navigate("/login"));
  }, [navigate]);

  const previous = results[results.length - 1];

  const readResult = useCallback(async (sessionId) => {
    setStage("reading");
    setError("");
    try {
      const response = await axios.post(
        `${SERVER_URL}/face/test-result`,
        { livenessSessionId: sessionId, compareWith: previous?.sessionId },
        requestConfig
      );
      setResults((list) => [...list, { sessionId, ...response.data }]);
      setStage("done");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not read the face check result.");
      setStage("idle");
    }
  }, [previous]);

  const logout = async () => {
    try {
      await axios.get(`${SERVER_URL}/logout`, requestConfig);
    } catch (logoutError) {
      // best-effort
    }
    navigate("/");
  };

  if (!user) return <PageLoader label="Loading…" />;

  const latest = results[results.length - 1];

  return (
    <AppShell
      role={user.role}
      name={user.name || user.email}
      email={user.email}
      onLogout={logout}
      links={user.role === "teacher" ? teacherLinks() : studentLinks()}
    >
      <PageHeader
        title="Face check test"
        subtitle="Tries the AWS liveness check on this phone. Run it once to see the liveness score, then again — yourself or someone else — to see the face match. Nothing here marks attendance; the captured frame is deleted within minutes."
      />

      {error && <p className="ui-field__error">{error}</p>}

      <Card>
        {stage === "checking" ? (
          <FaceCheck purpose="test" onFinished={readResult} onCancel={() => setStage(results.length ? "done" : "idle")} />
        ) : stage === "reading" ? (
          <div className="face-check face-check--message"><Spinner /> <span>Reading the result from the server…</span></div>
        ) : (
          <div className="face-check face-check--message">
            <p>{results.length === 0 ? "Good light, face the camera, follow the on-screen oval." : "Run another check to compare faces."}</p>
            <div className="face-check__actions">
              <Button onClick={() => setStage("checking")}>{results.length === 0 ? "Start face check" : "Run a second check & compare"}</Button>
              {results.length > 0 && <Button variant="ghost" onClick={() => setResults([])}>Start over</Button>}
            </div>
          </div>
        )}
      </Card>

      {latest && (
        <Card className="face-test__result" title={`Result ${results.length}`}>
          <div className="face-result">
            {latest.referenceImage ? <img src={latest.referenceImage} alt="Frame captured during the check" /> : <span className="ui-muted">No frame</span>}
            <div className="face-result__facts">
              <Badge variant={(VERDICT[latest.verdict] || VERDICT.failed).variant} dot>{(VERDICT[latest.verdict] || VERDICT.failed).label}</Badge>
              <span>Liveness confidence <strong>{latest.confidence.toFixed(1)}</strong> / 100 (pass mark {latest.thresholds.liveness})</span>
              <span className="ui-muted">AWS status: {latest.status}</span>
              {latest.comparison && (
                <>
                  <Badge variant={(MATCH[latest.comparison.decision] || MATCH.no_match).variant} dot>{(MATCH[latest.comparison.decision] || MATCH.no_match).label}</Badge>
                  <span>
                    Similarity to the previous check <strong>{latest.comparison.similarity.toFixed(1)}</strong> / 100
                    (match ≥ {latest.thresholds.match}, review ≥ {latest.thresholds.review})
                  </span>
                </>
              )}
            </div>
          </div>
        </Card>
      )}
    </AppShell>
  );
};

export default FaceTest;
