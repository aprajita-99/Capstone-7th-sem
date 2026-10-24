import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import { fetchSessionUser } from "../../utils/session";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import PageHeader from "../../ui/PageHeader";
import { studentLinks } from "./studentLinks";
import Icon from "../../ui/Icon";
import { PageLoader, Spinner } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { compressImage } from "../../utils/imageCompress";
import { signDeviceChallenge } from "../../utils/deviceKey";
import { postponeEnrollment } from "../../utils/enrollPrompt";
import FaceCheck from "../face/FaceCheck";
import "../face/faceCheck.css";
import "./enroll.css";

const requestConfig = { withCredentials: true };
const errorMessage = (requestError, fallback) => requestError.response?.data?.message || requestError.message || fallback;

const REASON_TEXT = {
  roll_mismatch: "the roll number on the ID card did not match your email",
  roll_unchecked: "the roll number on the ID card could not be read",
  face_unsure: "the face match with your ID card was not certain",
  face_mismatch: "the live face did not match your ID card photo",
  not_live: "the camera check did not look like a live person",
  liveness_incomplete: "the camera check did not finish",
};

const describeReasons = (reasons = []) => reasons.map((reason) => REASON_TEXT[reason] || reason).join("; ");

// Which wizard step fits the server's enrollment state.
const pickStep = (enrollment) => {
  if (["verified", "pending"].includes(enrollment.status)) return "result";
  if (enrollment.attemptsLeft === 0) return "result";
  if (enrollment.consentRequired) return "consent";
  return enrollment.idCardUploaded ? "selfie-ready" : "idcard";
};

/**
 * Identity enrollment wizard (Phase 8): consent → ID card → live selfie.
 * The server decides verified / waiting for teacher / try again.
 */
const Enroll = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState("loading"); // loading | consent | idcard | selfie | submitting | result
  const [agree, setAgree] = useState(false);
  const [idPreview, setIdPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastOutcome, setLastOutcome] = useState(null);

  const loadStatus = useCallback(async () => {
    const response = await axios.get(`${SERVER_URL}/enrollment/status`, requestConfig);
    setStatus(response.data.enrollment);
    return response.data.enrollment;
  }, []);

  useEffect(() => {
    fetchSessionUser()
      .then(async (response) => {
        if (response.data.user.role !== "student") {
          navigate("/teacher-dashboard");
          return;
        }
        setUser(response.data.user);
        setStep(pickStep(await loadStatus()));
      })
      .catch(() => navigate("/login"));
  }, [navigate, loadStatus]);

  const later = () => {
    postponeEnrollment();
    navigate("/student-dashboard");
  };

  const acceptConsent = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await axios.post(`${SERVER_URL}/enrollment/consent`, { version: status.consentVersion }, requestConfig);
      setStatus(response.data.enrollment);
      setStep(response.data.enrollment.idCardUploaded ? "selfie-ready" : "idcard");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not save your consent."));
    } finally {
      setBusy(false);
    }
  };

  const handleIdFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const image = await compressImage(file);
      setIdPreview(image);
      const response = await axios.post(`${SERVER_URL}/enrollment/id-card`, { image }, requestConfig);
      setStatus(response.data.enrollment);
      if (response.data.rollMatch === false) {
        toast("We couldn't find your roll number on the card. You can continue; a teacher will check it.", "info");
      }
      setStep("selfie-ready");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not upload the ID card."));
    } finally {
      setBusy(false);
    }
  };

  const submitSelfie = async (livenessSessionId) => {
    setStep("submitting");
    setError("");
    try {
      const proof = await signDeviceChallenge({ purpose: "face", payload: { livenessSessionId } });
      const response = await axios.post(`${SERVER_URL}/enrollment/selfie`, { livenessSessionId, ...proof }, requestConfig);
      setStatus(response.data.enrollment);
      setLastOutcome(response.data.outcome);
      setStep("result");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not submit the face check."));
      setStep("selfie-ready");
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

  if (!user || step === "loading" || !status) return <PageLoader label="Loading identity check…" />;

  const stepIndex = { consent: 1, idcard: 2, "selfie-ready": 3, selfie: 3, submitting: 3, result: 4 }[step] || 1;
  const verified = status.status === "verified";

  return (
    <AppShell role="student" name={user.name || user.email} email={user.email} onLogout={logout} links={studentLinks()}>
      <PageHeader
        back={{ to: "/student-dashboard", label: "Dashboard" }}
        title="Identity check"
        subtitle="One time only. It links your face to your college ID so check-ins can confirm it is really you."
      />

      <ol className="ready-path" aria-label="Getting ready for check-ins">
        <li className="is-done"><span className="ready-path__icon"><Icon name="phone" /></span><span><strong>Phone linked</strong><small>This phone is yours for check-ins</small></span></li>
        <li className={verified ? "is-done" : "is-current"}><span className="ready-path__icon"><Icon name="idcard" /></span><span><strong>Identity check</strong><small>ID card + live selfie, about 2 minutes</small></span></li>
        <li className={verified ? "is-done" : ""}><span className="ready-path__icon"><Icon name="check" /></span><span><strong>Ready for check-ins</strong><small>Join when your teacher starts one</small></span></li>
      </ol>

      <ol className="enroll-steps" aria-label="Progress">
        {["Consent", "ID card", "Live selfie", "Done"].map((label, index) => (
          <li key={label} className={index + 1 < stepIndex ? "is-done" : index + 1 === stepIndex ? "is-current" : ""}>
            <span className="enroll-steps__bar" aria-hidden="true" />
            {label}
          </li>
        ))}
      </ol>

      {error && <p className="ui-field__error enroll-error">{error}</p>}

      <Card>
        {step === "consent" && (
          <div className="enroll-body">
            <h2 className="enroll-title">Before you start</h2>
            <ul className="enroll-summary">
              <li><span className="enroll-summary__icon"><Icon name="camera" /></span><span><strong>What we collect</strong>A photo of your college ID card and a short live selfie.</span></li>
              <li><span className="enroll-summary__icon"><Icon name="shield" /></span><span><strong>Why</strong>To confirm the person checking in is you. Only you and your teachers can see it.</span></li>
              <li><span className="enroll-summary__icon"><Icon name="clock" /></span><span><strong>How long</strong>While you are on a class roster this term.</span></li>
            </ul>
            <details className="enroll-details">
              <summary>Full details</summary>
              <ul className="enroll-notice">
                <li><strong>What we collect:</strong> a photo of the front of your college ID card and a short live selfie video.</li>
                <li><strong>Why:</strong> to confirm the person checking in is you. Your live face becomes your reference photo for check-ins.</li>
                <li><strong>Who processes it:</strong> Amazon Web Services (Rekognition, Mumbai region) runs the face and liveness checks for us.</li>
                <li><strong>Who can see it:</strong> only you and the teachers of your classes.</li>
                <li><strong>How long:</strong> while you are on a class roster this term; it is deleted when you leave all rosters or a teacher resets it.</li>
                <li><strong>If something looks wrong:</strong> ask your teacher; they review unclear cases by hand.</li>
              </ul>
              <p className="enroll-privacy-link">Read the full <Link to="/privacy" target="_blank" rel="noopener">privacy notice</Link>.</p>
            </details>
            <label className="enroll-agree">
              <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
              I have read this and agree.
            </label>
            <div className="enroll-actions">
              <Button size="lg" onClick={acceptConsent} disabled={!agree} loading={busy}>Continue</Button>
              <Button variant="ghost" onClick={later}>Later</Button>
            </div>
          </div>
        )}

        {step === "idcard" && (
          <div className="enroll-body">
            <h2 className="enroll-title">Photo of your college ID card</h2>
            <div className="id-frame">
              {idPreview ? (
                <img className="enroll-id-preview" src={idPreview} alt="Your ID card" />
              ) : (
                <span className="id-frame__placeholder"><Icon name="idcard" size={40} />Front of your ID card</span>
              )}
            </div>
            <ul className="enroll-tips">
              <li><Icon name="check" size={14} /> Flat, front side</li>
              <li><Icon name="check" size={14} /> Good light, no glare</li>
              <li><Icon name="check" size={14} /> Photo and roll number readable</li>
            </ul>
            {busy ? (
              <p className="enroll-busy"><Spinner /> Checking the photo…</p>
            ) : (
              <div className="enroll-actions">
                <label className="ui-btn ui-btn--primary ui-btn--lg">
                  <Icon name="camera" /> Take photo
                  <input type="file" accept="image/*" capture="environment" hidden onChange={handleIdFile} />
                </label>
                <label className="ui-btn ui-btn--secondary ui-btn--lg">
                  Choose from gallery
                  <input type="file" accept="image/jpeg,image/png,image/*" hidden onChange={handleIdFile} />
                </label>
                <Button variant="ghost" onClick={later}>Later</Button>
              </div>
            )}
          </div>
        )}

        {step === "selfie-ready" && (
          <div className="enroll-body">
            <h2 className="enroll-title">Live selfie</h2>
            <ul className="enroll-tips">
              <li><Icon name="check" size={14} /> Face a light source</li>
              <li><Icon name="check" size={14} /> Hold the phone at eye level</li>
              <li><Icon name="check" size={14} /> Follow the oval on screen</li>
            </ul>
            <p className="ui-muted">
              Attempts left: <strong>{status.attemptsLeft}</strong> of {status.maxAttempts}.
            </p>
            {status.idCheck?.rollMatch === false && <Badge variant="warning" dot>Roll number not found on the card — a teacher will check it</Badge>}
            <div className="enroll-actions">
              <Button size="lg" onClick={() => setStep("selfie")}><Icon name="face" /> Start live selfie</Button>
              <Button variant="secondary" size="lg" onClick={() => setStep("idcard")}>Retake ID photo</Button>
              <Button variant="ghost" onClick={later}>Later</Button>
            </div>
          </div>
        )}

        {step === "selfie" && <FaceCheck purpose="enroll" onFinished={submitSelfie} onCancel={() => setStep("selfie-ready")} />}

        {step === "submitting" && (
          <p className="enroll-busy"><Spinner /> Comparing your live face with your ID card…</p>
        )}

        {step === "result" && (
          <div className="enroll-body enroll-result">
            {status.status === "verified" && (
              <>
                <span className="enroll-result__icon enroll-result__icon--ok"><Icon name="check" /></span>
                <h2 className="enroll-title">Identity verified</h2>
                <p className="ui-muted">Your live face is now your reference for check-ins. You’re ready.</p>
              </>
            )}
            {status.status === "pending" && (
              <>
                <span className="enroll-result__icon enroll-result__icon--wait"><Icon name="clock" /></span>
                <h2 className="enroll-title">Waiting for your teacher</h2>
                <p className="ui-muted">A teacher will check it because {describeReasons(status.reasons)}.</p>
              </>
            )}
            {!["verified", "pending"].includes(status.status) && (
              <>
                <span className="enroll-result__icon enroll-result__icon--fail"><Icon name="alert" /></span>
                <h2 className="enroll-title">{lastOutcome === "failed" ? "That didn't work" : "Identity check needed"}</h2>
                {status.rejectReason && <p className="ui-muted">Your teacher said: “{status.rejectReason}”</p>}
                {lastOutcome === "failed" && <p className="ui-muted">Reason: {describeReasons(status.reasons)}. Use your real face in good light — not a photo or screen.</p>}
                <p className="ui-muted">
                  {status.attemptsLeft > 0 ? `Attempts left: ${status.attemptsLeft} of ${status.maxAttempts}.` : "No attempts left. Ask your teacher to reset your identity check."}
                </p>
                {status.attemptsLeft > 0 && (
                  <div className="enroll-actions">
                    <Button size="lg" onClick={() => setStep(status.idCardUploaded ? "selfie-ready" : "idcard")}>Try again</Button>
                  </div>
                )}
              </>
            )}
            <div className="enroll-actions">
              <Button variant="secondary" onClick={() => navigate("/student-dashboard")}>Back to dashboard</Button>
            </div>
          </div>
        )}
      </Card>
    </AppShell>
  );
};

export default Enroll;
