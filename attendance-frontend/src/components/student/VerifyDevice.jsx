import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import AppShell from "../../ui/AppShell";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import PageHeader from "../../ui/PageHeader";
import { studentLinks } from "./studentLinks";
import Icon from "../../ui/Icon";
import { PageLoader, Spinner } from "../../ui/Spinner";
import { signDeviceChallenge } from "../../utils/deviceKey";
import FaceCheck from "../face/FaceCheck";
import "../face/faceCheck.css";
import "./enroll.css";

const requestConfig = { withCredentials: true };

/**
 * New phone for a verified student (Phase 8): a quick live face check on this
 * phone, compared with the saved reference face, approves the phone without
 * waiting for a teacher. If it does not match, the teacher reviews it as before.
 */
const VerifyDevice = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const requestId = location.state?.requestId;
  const [user, setUser] = useState(null);
  const [step, setStep] = useState("intro"); // intro | check | submitting | approved | review
  const [error, setError] = useState("");

  useEffect(() => {
    axios
      .get(`${SERVER_URL}/islogin`, requestConfig)
      .then((response) => setUser(response.data.user))
      .catch(() => navigate("/login"));
  }, [navigate]);

  useEffect(() => {
    if (!requestId) navigate("/student-dashboard");
  }, [requestId, navigate]);

  const submit = async (livenessSessionId) => {
    setStep("submitting");
    setError("");
    try {
      // Signed by THIS (new) phone's key, which is the one waiting for approval.
      const proof = await signDeviceChallenge({ purpose: "face", payload: { livenessSessionId } });
      const response = await axios.post(`${SERVER_URL}/device-bindings/face-verify`, { requestId, livenessSessionId, ...proof }, requestConfig);
      setStep(response.data.status === "approved" ? "approved" : "review");
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not verify this phone.");
      setStep("intro");
    }
  };

  const logout = async () => {
    try {
      await axios.get(`${SERVER_URL}/logout`, requestConfig);
    } catch {
      // best-effort
    }
    navigate("/");
  };

  if (!user || !requestId) return <PageLoader label="Loading…" />;

  return (
    <AppShell role="student" name={user.name || user.email} email={user.email} onLogout={logout} links={studentLinks()}>
      <PageHeader
        title="New phone"
        subtitle="You signed in on a phone that isn’t your approved one. Confirm it’s you with a quick face check, or wait for your teacher."
      />
      {error && <p className="ui-field__error enroll-error">{error}</p>}
      <Card>
        {step === "intro" && (
          <div className="enroll-body enroll-result">
            <span className="enroll-result__icon enroll-result__icon--wait"><Icon name="phone" /></span>
            <h2 className="enroll-title">Is this your new phone?</h2>
            <p className="ui-muted">Your live face is compared with the reference face from your identity check. A match approves this phone straight away; your old phone stops working for check-ins.</p>
            <div className="enroll-actions">
              <Button size="lg" onClick={() => setStep("check")}><Icon name="face" /> Verify with my face</Button>
              <Button variant="ghost" onClick={() => navigate("/student-dashboard")}>Wait for teacher instead</Button>
            </div>
          </div>
        )}
        {step === "check" && <FaceCheck purpose="rebind" extra={{ requestId }} onFinished={submit} onCancel={() => setStep("intro")} />}
        {step === "submitting" && <p className="enroll-busy"><Spinner /> Comparing with your reference face…</p>}
        {step === "approved" && (
          <div className="enroll-body enroll-result">
            <span className="enroll-result__icon enroll-result__icon--ok"><Icon name="check" /></span>
            <h2 className="enroll-title">This phone is approved</h2>
            <div className="enroll-actions"><Button onClick={() => navigate("/student-dashboard")}>Go to dashboard</Button></div>
          </div>
        )}
        {step === "review" && (
          <div className="enroll-body enroll-result">
            <span className="enroll-result__icon enroll-result__icon--wait"><Icon name="clock" /></span>
            <h2 className="enroll-title">Waiting for your teacher</h2>
            <p className="ui-muted">The face check wasn’t conclusive, so your teacher will approve this phone.</p>
            <div className="enroll-actions"><Button variant="secondary" onClick={() => navigate("/student-dashboard")}>Back to dashboard</Button></div>
          </div>
        )}
      </Card>
    </AppShell>
  );
};

export default VerifyDevice;
