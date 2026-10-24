import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import Icon from "../../ui/Icon";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import { PageLoader } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { roomLabel } from "../../utils/rooms";
import { shortWhen, untilLabel } from "../../utils/lockTime";
import { decisionText, explain, queryReasonLabel } from "./attendanceText";
import { studentLinks } from "./studentLinks";
import "./studentDashboard.css";
import "../checkin.css";

const QuerySheet = lazy(() => import("./QuerySheet"));

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

const StudentDashboard = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const toast = useToast();
    const [user, setUser] = useState(null);
    const [deviceStatus, setDeviceStatus] = useState(location.state?.deviceStatus || "checking");
    const [classes, setClasses] = useState(null);
    const [identity, setIdentity] = useState(null);
    const [openCheckins, setOpenCheckins] = useState([]);
    const [checkinIdentityOk, setCheckinIdentityOk] = useState(true);
    const [recent, setRecent] = useState([]);
    const [percentByClass, setPercentByClass] = useState({});
    const [querying, setQuerying] = useState(null);

    const loadRecent = useCallback(
        () => axios.get(`${SERVER_URL}/me/recent-checkins`, { withCredentials: true }).then((response) => setRecent(response.data.checkins)).catch(() => {}),
        []
    );

    useEffect(() => {
        const fetchUser = async () => {
            try {
                const response = await axios.get(`${SERVER_URL}/islogin`, { withCredentials: true });
                if (response.data.user.role === "teacher") {
                    navigate("/teacher-dashboard");
                    return;
                }
                setUser(response.data.user);
                axios.get(`${SERVER_URL}/enrollment/status`, { withCredentials: true })
                    .then((statusResponse) => setIdentity(statusResponse.data.enrollment))
                    .catch(() => {});
                const [bindingResponse, classesResponse] = await Promise.all([
                    axios.get(`${SERVER_URL}/device-bindings/status`, { withCredentials: true }),
                    axios.get(`${SERVER_URL}/me/classes`, { withCredentials: true }).catch(() => null),
                ]);
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

    // Open check-ins for the student's classes, refreshed every 10 seconds.
    useEffect(() => {
        if (!user) return undefined;
        const load = () =>
            axios
                .get(`${SERVER_URL}/sessions/active`, { withCredentials: true })
                .then((response) => {
                    setOpenCheckins(response.data.sessions);
                    setCheckinIdentityOk(response.data.identityVerified !== false);
                })
                .catch(() => {});
        load();
        const timer = window.setInterval(load, 10000);
        return () => window.clearInterval(timer);
    }, [user]);

    // Attendance % per class for the "Your classes" list (Phase 11).
    useEffect(() => {
        if (!user) return;
        axios
            .get(`${SERVER_URL}/me/attendance`, { withCredentials: true })
            .then((response) => setPercentByClass(Object.fromEntries(response.data.classes.map((item) => [String(item.class._id), item.summary]))))
            .catch(() => {});
    }, [user]);

    // Recent check-ins (decisions, queries), refreshed every 30 seconds.
    useEffect(() => {
        if (!user) return undefined;
        loadRecent();
        const timer = window.setInterval(loadRecent, 30000);
        return () => window.clearInterval(timer);
    }, [user, loadRecent]);

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

    return (
        <AppShell
            role="student"
            name={name}
            email={user.email}
            onLogout={handleLogout}
            links={studentLinks("dashboard")}
        >
            <PageHeader
                eyebrow="Student"
                title={`Hi ${firstName}`}
                subtitle="This is your attendance home. Check-ins happen right here once your teacher starts a session."
            />

            {openCheckins.length > 0 && (
                <Card className="checkin-open-card" title="Check-in open now">
                    {openCheckins.map((checkin) => (
                        <div key={checkin._id} className="checkin-open-card__row">
                            <span>
                                <strong>{checkin.class?.courseCode}{checkin.class?.section ? ` · ${checkin.class.section}` : ""}</strong>{" "}
                                <span className="ui-muted">{checkin.class?.title}</span>
                            </span>
                            {checkin.myStatus === "present" ? (
                                <Badge variant="success" dot>Present</Badge>
                            ) : checkin.myStatus === "review" ? (
                                <Badge variant="warning" dot>In review</Badge>
                            ) : checkin.faceRequired && !checkinIdentityOk ? (
                                <Button variant="soft" onClick={() => navigate("/student/enroll")}>Complete identity check to join</Button>
                            ) : (
                                <Button onClick={() => navigate(`/student/check-in/${checkin._id}`)}>
                                    {checkin.myStatus === "heard" ? "Continue face check" : "Join check-in"}
                                </Button>
                            )}
                        </div>
                    ))}
                </Card>
            )}

            <div className="student-grid">
                <Card className={`device-card device-card--${deviceStatus}`}>
                    <div className="device-card__top">
                        <span className="device-card__icon" aria-hidden="true"><Icon name={info.icon} /></span>
                        <Badge variant={info.variant} dot>{info.badge}</Badge>
                    </div>
                    <h2 className="device-card__title">{info.title}</h2>
                    <p className="device-card__text">{info.text}</p>
                    <div className="device-card__actions">
                        <Button variant="soft" onClick={() => navigate("/acoustic-lab")}><Icon name="sound" /> Test phone audio</Button>
                    </div>
                </Card>

                <Card title="When your teacher starts a check-in" subtitle="About 30–60 seconds, from this phone.">
                    <ol className="checkin-steps">
                        <li>
                            <strong>Tap Join.</strong>
                            A “Check-in open” card appears at the top of this page.
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
                </Card>
            </div>

            {recent.length > 0 && (
                <RecentCheckins checkins={recent} onQuery={setQuerying} onOpen={(checkin) => navigate(`/student/check-in/${checkin.sessionId}`)} />
            )}

            {identity && <IdentityCard identity={identity} onStart={() => navigate("/student/enroll")} />}

            <Card
                className="student-classes"
                title="Your classes"
                subtitle="Classes whose roster includes your college email."
                actions={<Link to="/student/attendance" className="ui-btn ui-btn--ghost ui-btn--sm">Attendance →</Link>}
            >
                {classes === null ? (
                    <p className="ui-muted">Loading…</p>
                ) : classes.length === 0 ? (
                    <EmptyState
                        icon="classes"
                        title="No classes yet"
                        text="You’ll see a class here once your teacher adds your college email to its roster."
                    />
                ) : (
                    <ul className="student-class-list">
                        {classes.map((courseClass) => (
                            <li key={courseClass._id} className="student-class">
                                <span className="student-class__code">
                                    {courseClass.courseCode}
                                    {courseClass.section ? ` · Section ${courseClass.section}` : ""}
                                </span>
                                <span className="student-class__title">{courseClass.title}</span>
                                <span className="student-class__meta">
                                    {roomLabel(courseClass.defaultRoom)}
                                    {courseClass.teacher?.name ? ` · ${courseClass.teacher.name}` : ""}
                                </span>
                                {percentByClass[String(courseClass._id)]?.percent != null && (
                                    <Link to="/student/attendance" className={`student-class__pct student-class__pct--${percentByClass[String(courseClass._id)].band}`}>
                                        {percentByClass[String(courseClass._id)].percent}% attendance
                                    </Link>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

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
