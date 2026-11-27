import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import { cachedGet, cachedSessionUser, fetchSessionUser, peekCached } from "../../utils/session";
import useLiveRefresh from "../../utils/useLiveRefresh";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import Icon from "../../ui/Icon";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import { PageLoader, Skeleton } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { roomLabel } from "../../utils/rooms";
import { shortWhen, untilLabel } from "../../utils/lockTime";
import { decisionText, explain, queryReasonLabel } from "./attendanceText";
import { studentLinks } from "./studentLinks";
import "./studentDashboard.css";
import "../checkin.css";

const QuerySheet = lazy(() => import("./QuerySheet"));

// The dashboard's GETs, also the keys of their cached responses.
const URLS = {
    identity: `${SERVER_URL}/enrollment/status`,
    binding: `${SERVER_URL}/device-bindings/status`,
    classes: `${SERVER_URL}/me/classes`,
    active: `${SERVER_URL}/sessions/active`,
    attendance: `${SERVER_URL}/me/attendance`,
    recent: `${SERVER_URL}/me/recent-checkins`,
};
const attendanceByClass = (data) =>
    data?.classes ? Object.fromEntries(data.classes.map((item) => [String(item.class._id), item])) : {};

const RECENT_BADGE = {
    present: { variant: "success", label: "Present" },
    review: { variant: "warning", label: "In review" },
    absent: { variant: "danger", label: "Absent" },
    joined: { variant: "info", label: "Checking in" },
    heard: { variant: "info", label: "Checking in" },
};

const classLabel = (courseClass) => (courseClass ? `${courseClass.courseCode}${courseClass.section ? ` · ${courseClass.section}` : ""}` : "Class");

// One line under a recent check-in: the decision, the query state, or why it is in review.
const recentDetail = (checkin) => {
    const decided = decisionText(checkin);
    if (decided) return decided;
    if (checkin.query) return `Query sent (${queryReasonLabel(checkin.query.reason).toLowerCase()}) — waiting for your teacher.`;
    if (checkin.status === "review") return `Your teacher will check it: ${explain(checkin.reasons) || "the check was not complete"}.`;
    if (checkin.status === "absent") return explain(checkin.reasons) ? `Marked absent: ${explain(checkin.reasons)}.` : "Marked absent.";
    return null;
};

// Check-ins that are not locked yet (Phase 10): status, teacher decision, and the query button.
const RecentCheckins = ({ checkins, onQuery, onOpen }) => (
    <Card
        className="student-classes recent-checkins"
        title="Recent check-ins"
        subtitle="If something went wrong, raise a query before the check-in locks at 09:00 the next morning."
        actions={<Link to="/student/attendance" className="ui-btn ui-btn--ghost ui-btn--sm">See all attendance →</Link>}
    >
        <ul className="recent-list">
            {checkins.map((checkin) => {
                const badge = RECENT_BADGE[checkin.status] || RECENT_BADGE.absent;
                const detail = recentDetail(checkin);
                return (
                    <li key={checkin.recordId} className={`recent-row recent-row--${checkin.status}`}>
                        <button type="button" className="recent-row__main" onClick={() => onOpen(checkin)}>
                            <span className="recent-row__class">
                                <strong>{classLabel(checkin.class)}</strong>
                                <span className="ui-muted">{shortWhen(checkin.startedAt)}</span>
                            </span>
                            <Badge variant={badge.variant} dot>{badge.label}</Badge>
                        </button>
                        {detail && <p className="recent-row__detail">{detail}</p>}
                        {checkin.canQuery && (
                            <div className="recent-row__action">
                                <Button variant="soft" size="sm" onClick={() => onQuery(checkin)}>Raise a query</Button>
                                <span className="ui-muted">{untilLabel(checkin.lockAt)}</span>
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    </Card>
);

const STATUS_VIEW = {
    approved: {
        badge: "Approved",
        variant: "success",
        icon: "check",
        title: "This browser is approved for attendance",
        text: "When your teacher starts a check-in, this phone will play and listen for the key tones.",
    },
    review: {
        badge: "In review",
        variant: "warning",
        icon: "clock",
        title: "Waiting for teacher review",
        text: "This browser was added from a new device. A teacher needs to approve it before you can check in.",
    },
    unbound: {
        badge: "Not bound",
        variant: "danger",
        icon: "warning",
        title: "This browser isn’t bound yet",
        text: "Sign in again with your college Google account to bind this browser to your attendance.",
    },
    checking: {
        badge: "Checking…",
        variant: "neutral",
        icon: "clock",
        title: "Checking this device…",
        text: "One moment while we look up this browser’s binding.",
    },
};

const identitySubtitle = (identity) => {
    if (identity.status === "verified") return "Verified — check-ins can confirm it's you.";
    if (identity.status === "pending") return "Waiting for your teacher to review it.";
    if (identity.attemptsLeft === 0) return "No attempts left — ask your teacher to reset it.";
    if (identity.status === "rejected") return `Rejected${identity.rejectReason ? `: "${identity.rejectReason}"` : ""}. Please try again.`;
    return "One-time check that links your face to your college ID.";
};

// Identity enrollment (Phase 8) status, with a Start / Try again button while attempts remain.
const IdentityCard = ({ identity, onStart }) => {
    const canStart = ["none", "rejected"].includes(identity.status) && identity.attemptsLeft > 0;
    const badge = identity.status === "verified"
        ? { variant: "success", label: "Verified" }
        : identity.status === "pending" ? { variant: "warning", label: "In review" } : { variant: "danger", label: "Blocked" };
    return (
        <Card
            className={`student-classes identity-card identity-card--${identity.status}`}
            title="Identity check"
            subtitle={identitySubtitle(identity)}
            actions={canStart
                ? <Button onClick={onStart}>{identity.status === "rejected" ? "Try again" : "Start"}</Button>
                : <Badge variant={badge.variant} dot>{badge.label}</Badge>}
        />
    );
};

const formatClock = (ms) => {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const greeting = (now) => {
    const hour = new Date(now).getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
};

// The open check-in, as the dark hero card at the top of the home page.
const LiveCheckinCard = ({ checkin, now, identityOk, onJoin, onEnroll }) => {
    const leftMs = new Date(checkin.closesAt).getTime() - now;
    return (
        <section className="live-hero">
            <div className="live-hero__top">
                <span className="live-hero__live"><span className="live-hero__dot" aria-hidden="true" />Live now</span>
                {leftMs > 0 && <span className="live-hero__timer">closes in {formatClock(leftMs)}</span>}
            </div>
            <div>
                <h2 className="live-hero__title">{classLabel(checkin.class)} is checking in</h2>
                {checkin.class?.title && <p className="live-hero__sub">{checkin.class.title}</p>}
            </div>
            {checkin.myStatus === "present" ? (
                <span className="live-hero__status"><Icon name="check" /> You’re marked present</span>
            ) : checkin.myStatus === "review" ? (
                <span className="live-hero__status"><Icon name="clock" /> In review — your teacher will check it</span>
            ) : checkin.faceRequired && !identityOk ? (
                <Button size="lg" block variant="soft" onClick={onEnroll}>Complete identity check to join</Button>
            ) : (
                <Button size="lg" block onClick={onJoin}>
                    <Icon name="sound" /> {checkin.myStatus === "heard" ? "Continue face check" : "Join check-in"}
                </Button>
            )}
        </section>
    );
};

// One class: big %, and what it takes to stay at 75%.
const AttendanceTile = ({ courseClass, item }) => {
    const summary = item?.summary;
    const band = summary?.band || "none";
    let line = "No check-ins counted yet";
    if (summary && summary.percent !== null) {
        if (band === "low") line = `Below 75% · attend next ${item.needed}`;
        else line = item.canMiss > 0 ? `Can miss ${item.canMiss} more` : "Right at 75% — don't miss the next";
    }
    return (
        <Link to="/student/attendance" className={`att-tile att-tile--${band}`}>
            <span className="att-tile__code">{courseClass.courseCode}{courseClass.section ? ` · ${courseClass.section}` : ""}</span>
            <strong className="att-tile__pct">{summary?.percent != null ? `${summary.percent}%` : "—"}</strong>
            <span className="att-tile__line">
                {band === "low" && <Icon name="warning" size={13} />}
                {band !== "low" && band !== "none" && <Icon name="check" size={13} />}
                {line}
            </span>
            <span className="att-tile__meta">
                {courseClass.title}
                {courseClass.teacher?.name ? ` · ${courseClass.teacher.name}` : ""}
                {courseClass.defaultRoom ? ` · ${roomLabel(courseClass.defaultRoom)}` : ""}
            </span>
        </Link>
    );
};

const StudentDashboard = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const toast = useToast();
    // Start from the last known data (if any) so the page shows at once; every
    // request below refreshes it.
    const [user, setUser] = useState(() => {
        const cachedUser = cachedSessionUser();
        return cachedUser?.role === "student" ? cachedUser : null;
    });
    const [deviceStatus, setDeviceStatus] = useState(location.state?.deviceStatus || peekCached(URLS.binding)?.status || "checking");
    const [classes, setClasses] = useState(() => peekCached(URLS.classes)?.classes ?? null);
    const [identity, setIdentity] = useState(() => peekCached(URLS.identity)?.enrollment ?? null);
    const [openCheckins, setOpenCheckins] = useState(() => peekCached(URLS.active)?.sessions ?? []);
    const [checkinIdentityOk, setCheckinIdentityOk] = useState(() => peekCached(URLS.active)?.identityVerified !== false);
    const [recent, setRecent] = useState(() => peekCached(URLS.recent)?.checkins ?? []);
    const [percentByClass, setPercentByClass] = useState(() => attendanceByClass(peekCached(URLS.attendance)));
    const [querying, setQuerying] = useState(null);
    const [now, setNow] = useState(Date.now());

    // Clock for the live check-in countdown.
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const loadRecent = useCallback(
        () => cachedGet(URLS.recent).then((response) => setRecent(response.data.checkins)).catch(() => {}),
        []
    );

    useEffect(() => {
        const fetchUser = async () => {
            // Start the page's requests together with the login check instead of
            // after it; the server still checks the login on each of them.
            const userRequest = fetchSessionUser();
            cachedGet(URLS.identity)
                .then((statusResponse) => setIdentity(statusResponse.data.enrollment))
                .catch(() => {});
            const bindingRequest = cachedGet(URLS.binding);
            bindingRequest.catch(() => {}); // handled below; ignored if this turns out to be a teacher
            const classesRequest = cachedGet(URLS.classes).catch(() => null);
            try {
                const response = await userRequest;
                if (response.data.user.role === "teacher") {
                    navigate("/teacher-dashboard");
                    return;
                }
                setUser(response.data.user);
                const [bindingResponse, classesResponse] = await Promise.all([bindingRequest, classesRequest]);
                setDeviceStatus(bindingResponse.data.status);
                setClasses(classesResponse ? classesResponse.data.classes : []);
            } catch (error) {
                if (error.response?.status && error.response.status !== 401) {
                    toast("Could not load your dashboard. Please try again.", "error");
                }
                navigate("/login");
            }
        };
        fetchUser();
    }, [navigate, toast]);

    // Open check-ins for the student's classes: every 10 seconds, and at once
    // when the student comes back to the app (phones pause timers in the background).
    const loadOpenCheckins = useCallback(
        () =>
            cachedGet(URLS.active)
                .then((response) => {
                    setOpenCheckins(response.data.sessions);
                    setCheckinIdentityOk(response.data.identityVerified !== false);
                })
                .catch(() => {}),
        []
    );
    useLiveRefresh(loadOpenCheckins, 10000, Boolean(user));

    // Attendance per class (summary, can-miss / needed) for the attendance tiles (Phase 11).
    const loadAttendance = useCallback(
        () => cachedGet(URLS.attendance).then((response) => setPercentByClass(attendanceByClass(response.data))).catch(() => {}),
        []
    );
    useLiveRefresh(loadAttendance, 60000, Boolean(user));

    // Recent check-ins (decisions, queries): every 30 seconds and on return to the app.
    useLiveRefresh(loadRecent, 30000, Boolean(user));

    const queryDone = () => {
        setQuerying(null);
        toast("Query sent. Your teacher will see it on their review list.", "success");
        loadRecent();
    };

    const handleLogout = useCallback(async () => {
        try {
            await axios.get(`${SERVER_URL}/logout`, { withCredentials: true });
        } catch (error) {
            // Sign-out is best-effort; the local session ends either way.
        }
        navigate("/");
        toast("Signed out. See you next class!", "success");
    }, [navigate, toast]);

    if (!user) {
        return <PageLoader label="Loading your dashboard…" />;
    }

    const info = STATUS_VIEW[deviceStatus] || STATUS_VIEW.checking;
    const name = user.name || user.email.split("@")[0];
    const firstName = name.split(" ")[0];
    const needsDevice = !["approved", "checking"].includes(deviceStatus);
    const needsIdentity = Boolean(identity) && identity.status !== "verified";
    const allSet = deviceStatus === "approved" && identity?.status === "verified";

    return (
        <AppShell
            role="student"
            name={name}
            email={user.email}
            onLogout={handleLogout}
            links={studentLinks("dashboard")}
        >
            <PageHeader eyebrow={greeting(now)} title={`Hi ${firstName}`}>
                {allSet && (
                    <div className="home-ready">
                        <Badge variant="success"><Icon name="check" size={13} /> Phone approved</Badge>
                        <Badge variant="success"><Icon name="check" size={13} /> Identity verified</Badge>
                    </div>
                )}
            </PageHeader>

            {openCheckins.length > 0 ? (
                <div className="live-hero-list">
                    {openCheckins.map((checkin) => (
                        <LiveCheckinCard
                            key={checkin._id}
                            checkin={checkin}
                            now={now}
                            identityOk={checkinIdentityOk}
                            onJoin={() => navigate(`/student/check-in/${checkin._id}`)}
                            onEnroll={() => navigate("/student/enroll")}
                        />
                    ))}
                </div>
            ) : (
                <section className="idle-hero">
                    <span className="idle-hero__icon" aria-hidden="true"><Icon name="headphones" /></span>
                    <div>
                        <strong>No check-in right now</strong>
                        <p>When your teacher starts one, it appears here. Keep this page open in class.</p>
                    </div>
                </section>
            )}

            {(needsDevice || needsIdentity) && (
                <section className="home-section">
                    <h2 className="home-section__title">Needs your attention</h2>
                    {needsDevice && (
                        <Card className={`device-card device-card--${deviceStatus}`}>
                            <div className="device-card__top">
                                <span className="device-card__icon" aria-hidden="true"><Icon name={info.icon} /></span>
                                <Badge variant={info.variant} dot>{info.badge}</Badge>
                            </div>
                            <h2 className="device-card__title">{info.title}</h2>
                            <p className="device-card__text">{info.text}</p>
                        </Card>
                    )}
                    {needsIdentity && <IdentityCard identity={identity} onStart={() => navigate("/student/enroll")} />}
                </section>
            )}

            <section className="home-section">
                <div className="home-section__head">
                    <h2 className="home-section__title">Your attendance</h2>
                    <Link to="/student/attendance" className="home-section__link">See all</Link>
                </div>
                {classes === null ? (
                    <div className="att-tiles">
                        <Skeleton height={132} card />
                        <Skeleton height={132} card />
                    </div>
                ) : classes.length === 0 ? (
                    <Card>
                        <EmptyState
                            icon="classes"
                            title="No classes yet"
                            text="You’ll see a class here once your teacher adds your college email to its roster."
                        />
                    </Card>
                ) : (
                    <div className="att-tiles">
                        {classes.map((courseClass) => (
                            <AttendanceTile key={courseClass._id} courseClass={courseClass} item={percentByClass[String(courseClass._id)]} />
                        ))}
                    </div>
                )}
            </section>

            {recent.length > 0 && (
                <RecentCheckins checkins={recent} onQuery={setQuerying} onOpen={(checkin) => navigate(`/student/check-in/${checkin.sessionId}`)} />
            )}

            <details className="how-it-works">
                <summary>How check-in works</summary>
                <ol className="checkin-steps">
                    <li>
                        <strong>Tap Join.</strong>
                        A “Live now” card appears at the top of this page when your teacher starts a check-in.
                    </li>
                    <li>
                        <strong>Your phone hears the key.</strong>
                        Keep it out, face-up; it listens for the near-silent tones played in the room.
                    </li>
                    <li>
                        <strong>Quick face check.</strong>
                        Follow the oval on screen. Then you’re marked present.
                    </li>
                </ol>
                <Button variant="soft" onClick={() => navigate("/acoustic-lab")}><Icon name="sound" /> Test phone audio</Button>
            </details>

            {querying && (
                <Suspense fallback={null}>
                    <QuerySheet
                        recordId={querying.recordId}
                        classLabel={classLabel(querying.class)}
                        lockAt={querying.lockAt}
                        onDone={queryDone}
                        onClose={() => setQuerying(null)}
                    />
                </Suspense>
            )}
        </AppShell>
    );
};

export default StudentDashboard;
