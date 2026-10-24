import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { FaCalendarCheck, FaChalkboardTeacher, FaExclamationTriangle, FaUserGraduate, FaMobileAlt } from "react-icons/fa";
import SERVER_URL from "../../config/api";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import Icon from "../../ui/Icon";
import { PageLoader } from "../../ui/Spinner";
import StatCard from "../../ui/StatCard";
import { useToast } from "../../ui/Toast";
import { roomLabel } from "../../utils/rooms";
import { fetchReviewCounts, teacherLinks } from "./teacherSession";
import "./teacherDashboard.css";

const requestConfig = { withCredentials: true };

// "3 attendance · 1 identity · 2 phones"
const reviewHint = (counts) =>
    [
        counts?.attendance ? `${counts.attendance} attendance` : null,
        counts?.enrollments ? `${counts.enrollments} identity` : null,
        counts?.devices ? `${counts.devices} phone${counts.devices === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" · ");

const TeacherDashboard = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [user, setUser] = useState(null);
    const [classes, setClasses] = useState([]);
    const [reviewCounts, setReviewCounts] = useState(null);
    const [report, setReport] = useState(null);
    const pendingReviews = reviewCounts?.total || 0;

    useEffect(() => {
        const load = async () => {
            try {
                const userResponse = await axios.get(`${SERVER_URL}/islogin`, requestConfig);
                if (userResponse.data.user.role !== "teacher") {
                    navigate("/student-dashboard");
                    return;
                }
                setUser(userResponse.data.user);

                const [classesResult, countsResult] = await Promise.allSettled([
                    axios.get(`${SERVER_URL}/classes`, requestConfig),
                    fetchReviewCounts(),
                ]);
                // Attendance numbers can take a moment (every class is summarised); load them separately.
                axios.get(`${SERVER_URL}/reports/summary`, requestConfig).then((response) => setReport(response.data)).catch(() => {});
                if (classesResult.status === "fulfilled") {
                    setClasses(classesResult.value.data.classes);
                } else {
                    toast("Could not load your classes.", "error");
                }
                if (countsResult.status === "fulfilled") {
                    setReviewCounts(countsResult.value);
                } else {
                    toast("Could not load all reviews.", "error");
                }
            } catch (error) {
                navigate("/login");
            }
        };
        load();
    }, [navigate, toast]);

    const handleLogout = useCallback(async () => {
        try {
            await axios.get(`${SERVER_URL}/logout`, requestConfig);
        } catch (error) {
            // Sign-out is best-effort; the local session ends either way.
        }
        navigate("/");
        toast("Signed out. See you next class!", "success");
    }, [navigate, toast]);

    if (!user) {
        return <PageLoader label="Loading your dashboard…" />;
    }

    const name = user.name || user.email.split("@")[0];
    const firstName = name.split(" ")[0];
    const studentCount = classes.reduce((sum, courseClass) => sum + (courseClass.activeStudentCount || 0), 0);

    return (
        <AppShell
            role="teacher"
            name={name}
            email={user.email}
            onLogout={handleLogout}
            links={teacherLinks("dashboard", reviewCounts)}
        >
            <PageHeader
                eyebrow="Teacher"
                title={`Welcome, ${firstName}`}
                subtitle="Run your classes, keep rosters current, and approve student devices before check-ins begin."
                actions={<Button onClick={() => navigate("/teacher/classes")}>Manage classes & rosters</Button>}
            />

            <div className="ui-grid ui-grid--stats">
                <StatCard icon={<FaChalkboardTeacher />} tone="indigo" label="Classes" value={classes.length} hint="Created by you" />
                <StatCard icon={<FaUserGraduate />} tone="sky" label="Active students" value={studentCount} hint="Across your rosters" />
                <StatCard
                    icon={<FaMobileAlt />}
                    tone={pendingReviews > 0 ? "amber" : "emerald"}
                    label="Pending reviews"
                    value={pendingReviews}
                    hint={pendingReviews > 0 ? reviewHint(reviewCounts) : "All clear"}
                    onClick={() => navigate("/teacher/reviews")}
                />
                <StatCard icon={<FaCalendarCheck />} tone="sky" label="Check-ins this week" value={report ? report.checkinsThisWeek : "…"} hint="Monday to Sunday" />
                <StatCard
                    icon={<FaExclamationTriangle />}
                    tone={report?.belowMin.count ? "rose" : "emerald"}
                    label={`Students below ${report?.minPercent || 75}%`}
                    value={report ? report.belowMin.count : "…"}
                    hint={report?.belowMin.count ? "Tap to see the class" : "Everyone is on track"}
                    onClick={report?.belowMin.worstClassId ? () => navigate(`/teacher/classes/${report.belowMin.worstClassId}?tab=attendance`) : undefined}
                />
            </div>

            {reviewCounts?.attendance > 0 && (
                <Card className="review-alert">
                    <div className="review-alert__row">
                        <span className="review-alert__icon" aria-hidden="true"><Icon name="warning" /></span>
                        <span className="review-alert__text">
                            <strong>{reviewCounts.attendance} attendance review{reviewCounts.attendance === 1 ? "" : "s"} waiting</strong>
                            <span className="ui-muted">
                                {reviewCounts.queries > 0 ? `${reviewCounts.queries} from student queries. ` : ""}
                                Undecided cases are marked absent when the check-in locks at 09:00.
                            </span>
                        </span>
                        <Button onClick={() => navigate("/teacher/reviews?tab=attendance")}>Review now</Button>
                    </div>
                </Card>
            )}

            <div className="teacher-grid">
                <Card
                    title="Recent classes"
                    subtitle="Your newest classes and their active roster counts."
                    actions={<Button variant="ghost" size="sm" onClick={() => navigate("/teacher/classes")}>View all</Button>}
                >
                    {classes.length === 0 ? (
                        <EmptyState
                            icon="classes"
                            title="No classes yet"
                            text="Create your first class and paste its roster — check-ins will be attributed to these students."
                            action={<Button variant="soft" onClick={() => navigate("/teacher/classes")}>Create a class</Button>}
                        />
                    ) : (
                        <ul className="class-list">
                            {classes.slice(0, 4).map((courseClass) => (
                                <li key={courseClass._id}>
                                    <button type="button" className="class-list__item" onClick={() => navigate(`/teacher/classes/${courseClass._id}`)}>
                                        <span className="class-list__main">
                                            <span className="class-list__title">
                                                {courseClass.title}
                                                <span className="class-list__code">
                                                    {courseClass.courseCode}{courseClass.section ? ` · ${courseClass.section}` : ""}
                                                </span>
                                            </span>
                                            <span className="class-list__meta">{roomLabel(courseClass.defaultRoom)}</span>
                                        </span>
                                        <Badge variant="neutral">{courseClass.activeStudentCount || 0} students</Badge>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                <Card title="Quick actions" subtitle="The things you’ll do most often.">
                    <div className="quick-actions">
                        <button type="button" className="quick-action" onClick={() => navigate("/teacher/reviews")}>
                            <span className="quick-action__icon" aria-hidden="true"><Icon name="check" /></span>
                            <span className="quick-action__body">
                                <strong>Reviews</strong>
                                <small>Unsure check-ins, student queries, identity checks and new phones</small>
                            </span>
                        </button>
                        <button type="button" className="quick-action" onClick={() => navigate("/teacher/classes")}>
                            <span className="quick-action__icon" aria-hidden="true"><Icon name="users" /></span>
                            <span className="quick-action__body">
                                <strong>Classes & rosters</strong>
                                <small>Create classes, paste rosters, start check-ins</small>
                            </span>
                        </button>
                        <button type="button" className="quick-action" onClick={() => navigate("/acoustic-lab")}>
                            <span className="quick-action__icon" aria-hidden="true"><Icon name="sound" /></span>
                            <span className="quick-action__body">
                                <strong>Phone audio test</strong>
                                <small>Check that a phone can play and hear the key tones</small>
                            </span>
                        </button>
                    </div>
                </Card>
            </div>
        </AppShell>
    );
};

export default TeacherDashboard;
