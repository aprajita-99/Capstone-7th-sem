import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import { PageLoader } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { shortWhen, untilLabel } from "../../utils/lockTime";
import { STATUS_LABEL, decisionText, explain, queryReasonLabel } from "./attendanceText";
import { studentLinks } from "./studentLinks";
import "./studentDashboard.css";
import "../checkin.css";

const QuerySheet = lazy(() => import("./QuerySheet"));
const requestConfig = { withCredentials: true };

const classLabel = (courseClass) => `${courseClass.courseCode}${courseClass.section ? ` · ${courseClass.section}` : ""}`;

// "You can miss 2 more…" / "Attend the next 3 in a row…"
const outlook = (item, minPercent) => {
  const { summary } = item;
  if (summary.counted === 0) return "No check-ins counted yet.";
  if (summary.percent >= minPercent) {
    return item.canMiss > 0
      ? `You can miss ${item.canMiss} more and stay at ${minPercent}%.`
      : `You're right at ${minPercent}% — don't miss the next one.`;
  }
  return `Attend the next ${item.needed} in a row to reach ${minPercent}%.`;
};

// One line under a check-in: who decided, the query state, or why.
const detail = (checkin) => {
  if (!checkin.counted && checkin.sessionStatus === "open") return "Check-in is open now.";
  const decided = decisionText(checkin);
  if (decided) return decided;
  if (checkin.query) return `Query sent (${queryReasonLabel(checkin.query.reason).toLowerCase()}) — waiting for your teacher.`;
  if (checkin.status === "review") return "Your teacher will check it; it counts once decided.";
  const why = explain(checkin.reasons);
  return why ? why.charAt(0).toUpperCase() + why.slice(1) + "." : null;
};

const ClassCard = ({ item, minPercent, expanded, onToggle, onQuery }) => {
  const { summary } = item;
  return (
    <Card className={`my-att my-att--${summary.band}`}>
      <button type="button" className="my-att__head" onClick={onToggle} aria-expanded={expanded}>
        <span className="my-att__class">
          <strong>{classLabel(item.class)}</strong>
          <span className="ui-muted">{item.class.title}</span>
        </span>
        <span className="my-att__pct">{summary.percent === null ? "—" : `${summary.percent}%`}</span>
      </button>
      <div className="my-att__bar" aria-hidden="true">
        <span className="my-att__fill" style={{ width: `${summary.percent ?? 0}%` }} />
        <span className="my-att__mark" style={{ left: `${minPercent}%` }} />
      </div>
      <p className="my-att__outlook">{outlook(item, minPercent)}</p>
      <p className="ui-muted my-att__counts">
        {summary.present} of {summary.counted} attended{summary.pending ? ` · ${summary.pending} in review (not counted yet)` : ""}
      </p>

      {expanded && (
        <ul className="recent-list my-att__list">
          {item.checkins.length === 0 && <li className="ui-muted">No check-ins yet.</li>}
          {item.checkins.map((checkin) => {
            const badge = STATUS_LABEL[checkin.status] || STATUS_LABEL.absent;
            const line = detail(checkin);
            return (
              <li key={checkin.sessionId} className={`recent-row recent-row--${checkin.status}`}>
                <div className="recent-row__main recent-row__main--static">
                  <span className="recent-row__class">
                    <strong>{shortWhen(checkin.startedAt)}</strong>
                    {!checkin.counted && <span className="ui-muted">Not counted yet</span>}
                  </span>
                  <Badge variant={badge.variant} dot>{badge.label}</Badge>
                </div>
                {line && <p className="recent-row__detail">{line}</p>}
                {checkin.canQuery && (
                  <div className="recent-row__action">
                    <Button variant="soft" size="sm" onClick={() => onQuery(item, checkin)}>Raise a query</Button>
                    <span className="ui-muted">{untilLabel(checkin.lockAt)}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="my-att__toggle" onClick={onToggle}>{expanded ? "Hide check-ins" : `Show ${item.checkins.length} check-in${item.checkins.length === 1 ? "" : "s"}`}</button>
    </Card>
  );
};

/**
 * Student attendance (Phase 11): % per class over closed check-ins, what it
 * takes to stay at 75%, every check-in with its decision, queries until the lock.
 */
const StudentAttendance = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [querying, setQuerying] = useState(null);

  const load = useCallback(
    () =>
      axios.get(`${SERVER_URL}/me/attendance`, requestConfig).then((response) => {
        setData(response.data);
        setExpanded((current) => (current.size ? current : new Set(response.data.classes.filter((item) => item.current).slice(0, 1).map((item) => String(item.class._id)))));
      }),
    []
  );

  useEffect(() => {
    axios
      .get(`${SERVER_URL}/islogin`, requestConfig)
      .then((response) => {
        if (response.data.user.role === "teacher") {
          navigate("/teacher-dashboard");
          return;
        }
        setUser(response.data.user);
        load().catch(() => toast("Could not load your attendance.", "error"));
      })
      .catch(() => navigate("/login"));
  }, [navigate, toast, load]);

  const logout = async () => {
    try {
      await axios.get(`${SERVER_URL}/logout`, requestConfig);
    } catch (error) {
      // Sign-out is best-effort; the local session ends either way.
    }
    navigate("/");
  };

  if (!user || !data) return <PageLoader label="Loading your attendance…" />;

  const toggle = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const current = data.classes.filter((item) => item.current);
  const past = data.classes.filter((item) => !item.current);
  const renderCard = (item) => (
    <ClassCard
      key={item.class._id}
      item={item}
      minPercent={data.minPercent}
      expanded={expanded.has(String(item.class._id))}
      onToggle={() => toggle(String(item.class._id))}
      onQuery={(classItem, checkin) => setQuerying({ classItem, checkin })}
    />
  );

  return (
    <AppShell role="student" name={user.name || user.email} email={user.email} onLogout={logout} links={studentLinks("attendance")}>
      <Link to="/student-dashboard" className="ui-btn ui-btn--ghost ui-btn--sm">← Dashboard</Link>
      <div className="ui-page-head">
        <div>
          <h1 className="ui-page-head__title">Your attendance</h1>
          <p className="ui-page-head__sub">
            Counted over closed check-ins. Cases in review count once your teacher decides. You need at least {data.minPercent}%.
          </p>
        </div>
      </div>

      {data.classes.length === 0 ? (
        <Card>
          <EmptyState icon="📊" title="No attendance yet" text="Your classes appear here after their first check-in." />
        </Card>
      ) : (
        <>
          {current.length > 0 ? <div className="my-att-list">{current.map(renderCard)}</div> : <p className="ui-muted">You are not on any class roster right now.</p>}
          {past.length > 0 && (
            <section className="my-att-past">
              <h2 className="my-att-past__title">Past classes</h2>
              <p className="ui-muted">Classes you were removed from, or that your teacher archived. Read only.</p>
              <div className="my-att-list">{past.map(renderCard)}</div>
            </section>
          )}
        </>
      )}

      {querying && (
        <Suspense fallback={null}>
          <QuerySheet
            recordId={querying.checkin.recordId}
            classLabel={classLabel(querying.classItem.class)}
            lockAt={querying.checkin.lockAt}
            onDone={() => {
              setQuerying(null);
              toast("Query sent. Your teacher will see it on their review list.", "success");
              load().catch(() => {});
            }}
            onClose={() => setQuerying(null)}
          />
        </Suspense>
      )}
    </AppShell>
  );
};

export default StudentAttendance;
