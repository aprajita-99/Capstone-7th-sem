import React, { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./Login.css";
import img1 from "../../assets/logo.png";
import SERVER_URL from "../../config/api";
import { clearSession } from "../../utils/session";
import GoogleSignInButton from "./GoogleSignInButton";
import { getOrCreateDevicePublicKey, publicKeyPayload, signDeviceChallenge } from "../../utils/deviceKey";
import { enrollmentPostponed } from "../../utils/enrollPrompt";
import Brand from "../../ui/Brand";
import { Spinner } from "../../ui/Spinner";

const Login = () => {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    const handleGoogleCredential = useCallback(async ({ credential }) => {
        setError("");
        setIsLoading(true);

        try {
            const response = await fetch(`${SERVER_URL}/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ credential }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || "Google sign-in was not accepted.");
            clearSession(); // a new account: never reuse a cached user from before

            let deviceStatus = "approved";
            if (data.user.role === "student") {
                const publicKeyJwk = await getOrCreateDevicePublicKey();
                // Prove this browser holds the private half of the key it submits.
                const proof = await signDeviceChallenge({ purpose: "bind", payload: publicKeyPayload(publicKeyJwk) });
                const bindingResponse = await fetch(`${SERVER_URL}/device-bindings/claim`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ publicKeyJwk, ...proof }),
                });
                const bindingData = await bindingResponse.json();
                if (!bindingResponse.ok) throw new Error(bindingData.message || "Could not bind this browser to your attendance account.");
                deviceStatus = bindingData.status;

                // New phone of a verified student: offer a quick face check instead of waiting for a teacher.
                if (bindingData.status === "review" && bindingData.faceVerifyAvailable) {
                    navigate("/student/verify-device", { state: { requestId: bindingData.requestId } });
                    return;
                }
                // First sign-in (or unfinished): open the identity check unless the student chose "Later".
                if (bindingData.status === "approved" && !enrollmentPostponed()) {
                    const statusResponse = await fetch(`${SERVER_URL}/enrollment/status`, { credentials: "include" });
                    const statusData = statusResponse.ok ? await statusResponse.json() : null;
                    const enrollment = statusData?.enrollment;
                    if (enrollment && ["none", "rejected"].includes(enrollment.status) && enrollment.attemptsLeft > 0) {
                        navigate("/student/enroll");
                        return;
                    }
                }
            }

            navigate(data.user.role === "teacher" ? "/teacher-dashboard" : "/student-dashboard", { state: { deviceStatus } });
        } catch (requestError) {
            setError(requestError.message || "Google sign-in failed. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }, [navigate]);

    return (
        <div className="login-page">
            <aside className="login-brand">
                <div className="login-brand__top">
                    <Brand />
                </div>
                <div className="login-brand__content">
                    <span className="login-brand__badge">Sound + face check-in</span>
                    <h1>Attendance that proves who’s actually in the room.</h1>
                    <p>
                        Your phone hears a near-silent key played in class, then a quick live face check
                        confirms it’s you. No GPS, no roll call, no extra hardware.
                    </p>
                    <ul className="login-brand__points">
                        <li>College Google sign-in — nothing to remember</li>
                        <li>Check-ins count only from your own phone</li>
                        <li>Unsure cases go to your teacher, never silently absent</li>
                    </ul>
                </div>
                <div className="login-brand__wave" aria-hidden="true">
                    {[12, 22, 34, 20, 28, 14, 24, 34, 18, 26, 12, 20].map((height, index) => (
                        <span key={index} style={{ height: `${height}px`, animationDelay: `${(index % 6) * 0.14}s` }} />
                    ))}
                </div>
            </aside>

            <main className="login-panel">
                <div className="login-card">
                    <img src={img1} alt="MarkMePresent" className="login-card__logo" />
                    <h2>Welcome back</h2>
                    <p className="login-card__sub">Sign in with your college account to continue.</p>
                    <p className="login-card__roles">
                        <strong>Teachers and students use the same button</strong> — MarkMePresent opens the right page for your account.
                        Students: use your own phone. <Link to="/#sign-in">How to sign in</Link>
                    </p>

                    <div className="google-login-block">
                        <GoogleSignInButton
                            onCredential={handleGoogleCredential}
                            onLoadError={setError}
                            disabled={isLoading}
                        />
                        {isLoading && (
                            <p className="login-card__status">
                                <Spinner /> Signing you in…
                            </p>
                        )}
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <p className="login-card__help">
                        Need access? Ask your teacher to add your college email to the class roster.
                    </p>
                </div>
                <p className="login-foot">MarkMePresent · NIT Jamshedpur</p>
            </main>
        </div>
    );
};

export default Login;
