import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import Spinner, { PageLoader } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { useConfirm } from "../../ui/Confirm";
import { teacherLinks, useTeacherSession } from "./teacherSession";
import "./classes.css";
import "./reviews.css";
import "../checkin.css";

// Review cards with photos load only when the Attendance tab is opened.
const AttendanceReviews = lazy(() => import("./AttendanceReviews"));
const TAB_IDS = ["attendance", "enrollments", "devices"];

const requestConfig = { withCredentials: true };
const errorMessage = (requestError, fallback) => requestError.response?.data?.message || fallback;
const mediaUrl = (id) => `${SERVER_URL}/media/${id}`;

const REASON_LABEL = {
  roll_mismatch: "Roll number on the card ≠ email",
  roll_unchecked: "Roll number not read",
  face_unsure: "Face match unsure",
  face_mismatch: "Face doesn't match ID",
};

const EnrollmentCard = ({ row, busy, onDecide, onReset, onForce }) => {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <article className="enroll-review">
      <div className="enroll-review__images">
        <figure>
          {row.idCardMedia ? <img src={mediaUrl(row.idCardMedia)} alt={`ID card of ${row.name}`} /> : <span className="ui-muted">No ID image</span>}
          <figcaption>ID card</figcaption>
        </figure>
        <figure>
          {row.selfieMedia ? <img src={mediaUrl(row.selfieMedia)} alt={`Live selfie of ${row.name}`} /> : <span className="ui-muted">No live selfie</span>}
          <figcaption>Live selfie</figcaption>
        </figure>
      </div>
      <div className="enroll-review__facts">
        <strong>{row.name}</strong>
        <span className="ui-muted">{row.email} · roll {row.rollNumber}</span>
        <div className="enroll-review__badges">
          {row.reasons.map((reason) => <Badge key={reason} variant="warning">{REASON_LABEL[reason] || reason}</Badge>)}
          {row.idCheck?.rollMatch === true && <Badge variant="success">Roll number found on card</Badge>}
        </div>
        {row.scores && (
          <span className="ui-muted">
            Face similarity {Number(row.scores.similarity || 0).toFixed(1)} · liveness {Number(row.scores.liveness || 0).toFixed(1)} · attempts {row.attempts}
          </span>
        )}
        {rejecting ? (
          <div className="enroll-review__reject">
            <textarea className="ui-textarea" rows={2} maxLength={300} placeholder="Reason the student will see, e.g. 'ID card belongs to someone else'" value={reason} onChange={(event) => setReason(event.target.value)} />
            <div className="enroll-review__actions">
              <Button variant="danger" size="sm" disabled={!reason.trim() || busy} onClick={() => onDecide(row, "rejected", reason)}>Reject</Button>
              <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="enroll-review__actions">
            {row.status === "pending" && <Button size="sm" disabled={busy} onClick={() => onDecide(row, "approved")}>Approve</Button>}
            {row.status === "pending" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>Reject…</Button>}
            {row.status !== "pending" && <Button size="sm" variant="soft" disabled={busy} onClick={() => onReset(row)}>Reset attempts</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onForce(row)}>Force re-enroll</Button>
          </div>
        )}
      </div>
    </article>
  );
};

/**
 * Teacher reviews: attendance cases from check-ins that are not locked yet
 * (Phase 10), identity enrollments and new-device requests (Phase 8) — the
 * cases the system could not decide on its own.
 */
const Reviews = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout, counts, refreshCounts } = useTeacherSession();
  const requestedTab = TAB_IDS.includes(searchParams.get("tab")) ? searchParams.get("tab") : null;
  const [tab, setTabState] = useState(requestedTab);
  const [devices, setDevices] = useState(null);
  const [enrollments, setEnrollments] = useState({ reviews: [], blocked: [] });
  const [attendance, setAttendance] = useState([]);
  const [busy, setBusy] = useState(false);

  const setTab = (next) => {
    setTabState(next);
    setSearchParams({ tab: next }, { replace: true });
  };

  const load = useCallback(async () => {
    const [deviceResponse, enrollmentResponse, attendanceResponse] = await Promise.all([
      axios.get(`${SERVER_URL}/device-reviews`, requestConfig),
      axios.get(`${SERVER_URL}/enrollment-reviews`, requestConfig),
      axios.get(`${SERVER_URL}/reviews?type=attendance`, requestConfig),
    ]);
    setDevices(deviceResponse.data.reviews);
    setEnrollments({ reviews: enrollmentResponse.data.reviews, blocked: enrollmentResponse.data.blocked || [] });
    setAttendance(attendanceResponse.data.groups || []);
    // Open the tab with something waiting, attendance first.
    const waiting = { attendance: (attendanceResponse.data.groups || []).length, enrollments: enrollmentResponse.data.reviews.length, devices: deviceResponse.data.reviews.length };
    setTabState((current) => current || TAB_IDS.find((id) => waiting[id] > 0) || "attendance");
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch(() => {
      toast("Could not load reviews.", "error");
      setDevices((current) => current || []);
      setTabState((current) => current || "attendance");
    });
  }, [user, load, toast]);

  const run = async (action, success) => {
    setBusy(true);
    try {
      const message = await action();
      toast(message || success, "success");
      await load();
      refreshCounts();
    } catch (requestError) {
      toast(errorMessage(requestError, "That did not work."), "error");
    } finally {
      setBusy(false);
    }
  };

  const decideAttendance = (record, status, note) =>
    run(() => axios.post(`${SERVER_URL}/records/${record._id}/decision`, { status, note }, requestConfig), `${record.name || record.email.split("@")[0]} marked ${status}.`);
  const bulkPresent = (recordIds) =>
    run(async () => {
      const response = await axios.post(`${SERVER_URL}/records/bulk-decision`, { recordIds, status: "present" }, requestConfig);
      const { updated, skipped } = response.data;
      return `${updated.length} marked present${skipped.length ? ` · ${skipped.length} skipped (already decided or locked)` : ""}.`;
    }, "Marked present.");

  const decideDevice = (review, decision) =>
    run(() => axios.post(`${SERVER_URL}/device-reviews/${review._id}`, { decision }, requestConfig), decision === "approved" ? "Device approved." : "Device rejected.");
  const decideEnrollment = (row, decision, reason) =>
    run(() => axios.post(`${SERVER_URL}/enrollment-reviews/${row.userId}`, { decision, reason }, requestConfig), decision === "approved" ? `${row.name} verified.` : `${row.name} rejected.`);
  const resetAttempts = (row) =>
    run(() => axios.post(`${SERVER_URL}/enrollment-reviews/${row.userId}/reset-attempts`, {}, requestConfig), `${row.name} can try again.`);
  const forceReenroll = async (row) => {
    if (!(await confirm({
      title: `Clear ${row.name}'s identity check?`,
      message: "Their ID and face photos are deleted and they must enroll again.",
      confirmLabel: "Clear and re-enroll",
    }))) return;
    run(() => axios.post(`${SERVER_URL}/enrollment-reviews/${row.userId}/force-reenroll`, {}, requestConfig), `${row.name} must enroll again.`);
  };

  if (!user || devices === null || !tab) return <PageLoader label="Loading reviews…" />;

  const enrollmentCount = enrollments.reviews.length + enrollments.blocked.length;
  const attendanceCount = attendance.reduce((sum, group) => sum + group.records.length, 0);

  return (
    <AppShell role="teacher" name={user.name || user.email} email={user.email} onLogout={logout} links={teacherLinks("reviews", counts)}>
      <PageHeader
        title="Reviews"
        subtitle="Cases the system could not decide on its own. Check-ins lock at 09:00 the next morning; anything still undecided is then marked absent."
      />

      <div className="review-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "attendance"} className={tab === "attendance" ? "is-active" : ""} onClick={() => setTab("attendance")}>
          Attendance <Badge variant={attendanceCount ? "warning" : "neutral"}>{attendanceCount}</Badge>
        </button>
        <button type="button" role="tab" aria-selected={tab === "enrollments"} className={tab === "enrollments" ? "is-active" : ""} onClick={() => setTab("enrollments")}>
          Identity checks <Badge variant={enrollmentCount ? "warning" : "neutral"}>{enrollmentCount}</Badge>
        </button>
        <button type="button" role="tab" aria-selected={tab === "devices"} className={tab === "devices" ? "is-active" : ""} onClick={() => setTab("devices")}>
          New phones <Badge variant={devices.length ? "warning" : "neutral"}>{devices.length}</Badge>
        </button>
      </div>

      {tab === "attendance" && (
        <Suspense fallback={<div className="att-loading"><Spinner /> <span className="ui-muted">Loading reviews…</span></div>}>
          <AttendanceReviews groups={attendance} busy={busy} onDecide={decideAttendance} onBulkPresent={bulkPresent} />
        </Suspense>
      )}

      {tab === "enrollments" && (
        <>
          <Card title="Waiting for you" subtitle="Compare the ID card with the live selfie and the roll number.">
            {enrollments.reviews.length === 0 ? (
              <EmptyState icon="idcard" title="Nothing to review" text="Identity checks that match strongly are verified automatically." />
            ) : (
              <div className="enroll-review-list">
                {enrollments.reviews.map((row) => (
                  <EnrollmentCard key={row.userId} row={row} busy={busy} onDecide={decideEnrollment} onReset={resetAttempts} onForce={forceReenroll} />
                ))}
              </div>
            )}
          </Card>
          {enrollments.blocked.length > 0 && (
            <Card className="classes-section" title="Out of attempts" subtitle="These students used all their attempts. Reset to let them try again.">
              <div className="enroll-review-list">
                {enrollments.blocked.map((row) => (
                  <EnrollmentCard key={row.userId} row={row} busy={busy} onDecide={decideEnrollment} onReset={resetAttempts} onForce={forceReenroll} />
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {tab === "devices" && (
        <Card title="New-phone requests" subtitle="Students who signed in from a different phone and could not confirm it with their face. Approve only if you know the change is genuine.">
          {devices.length === 0 ? (
            <p className="ui-muted">No students are waiting for a device change review.</p>
          ) : (
            <ul className="review-list">
              {devices.map((review) => (
                <li key={review._id} className="review-row">
                  <span className="review-row__who">
                    <strong>{review.student?.name || "Student"}</strong>
                    <span>{review.student?.email}</span>
                  </span>
                  <span className="review-row__actions">
                    <Button size="sm" variant="soft" onClick={() => decideDevice(review, "approved")} disabled={busy}>Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => decideDevice(review, "rejected")} disabled={busy}>Reject</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </AppShell>
  );
};

export default Reviews;
