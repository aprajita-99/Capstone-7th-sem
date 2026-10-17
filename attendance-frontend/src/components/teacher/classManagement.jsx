import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import Field from "../../ui/Field";
import { PageLoader } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { roomLabel } from "../../utils/rooms";
import RoomPicker from "./RoomPicker";
import { teacherLinks, useTeacherSession } from "./teacherSession";
import "./classes.css";

const blankClass = { courseCode: "", title: "", section: "", roomId: "" };
const requestConfig = { withCredentials: true };
const errorMessage = (requestError, fallback) => requestError.response?.data?.message || fallback;

const ClassManagement = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, logout } = useTeacherSession();
  const [classes, setClasses] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [formData, setFormData] = useState(blankClass);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    const [classesResponse, roomsResponse, reviewsResponse] = await Promise.all([
      axios.get(`${SERVER_URL}/classes${showArchived ? "?archived=1" : ""}`, requestConfig),
      axios.get(`${SERVER_URL}/rooms`, requestConfig),
      axios.get(`${SERVER_URL}/device-reviews`, requestConfig),
    ]);
    setClasses(classesResponse.data.classes);
    setRooms(roomsResponse.data.rooms);
    setReviews(reviewsResponse.data.reviews);
  }, [showArchived]);

  useEffect(() => {
    if (!user) return;
    loadData().catch(() => toast("Could not load your classes.", "error"));
  }, [user, loadData, toast]);

  const handleCreateClass = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const response = await axios.post(`${SERVER_URL}/classes`, formData, requestConfig);
      toast(`${response.data.courseClass.courseCode} created. Add its students next.`, "success");
      navigate(`/teacher/classes/${response.data.courseClass._id}`);
    } catch (requestError) {
      setFormError(errorMessage(requestError, "Could not create the class."));
    } finally {
      setSaving(false);
    }
  };

  const decideReview = async (reviewId, decision) => {
    setSaving(true);
    try {
      await axios.post(`${SERVER_URL}/device-reviews/${reviewId}`, { decision }, requestConfig);
      toast(decision === "approved" ? "Device approved." : "Device rejected.", "success");
      await loadData();
    } catch (requestError) {
      toast(errorMessage(requestError, "Could not update this device review."), "error");
    } finally {
      setSaving(false);
    }
  };

  if (!user || classes === null) return <PageLoader label="Loading your classes…" />;

  const setField = (field) => (event) => setFormData({ ...formData, [field]: event.target.value });

  return (
    <AppShell
      role="teacher"
      name={user.name || user.email}
      email={user.email}
      onLogout={logout}
      links={teacherLinks("classes")}
    >
      <div className="ui-page-head">
        <div>
          <h1 className="ui-page-head__title">Classes & rosters</h1>
          <p className="ui-page-head__sub">
            Create a class once, add its students, and reuse the roster for every check-in.
          </p>
        </div>
      </div>

      <div className="classes-grid">
        <Card title="Your classes" subtitle="Open a class to manage its roster."
          actions={
            <label className="classes-toggle">
              <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
              Show archived
            </label>
          }
        >
          {classes.length === 0 ? (
            <EmptyState
              icon="🏫"
              title={showArchived ? "No classes yet" : "No active classes"}
              text="Create your first class with the form — it takes a few seconds."
            />
          ) : (
            <ul className="class-cards">
              {classes.map((courseClass) => (
                <li key={courseClass._id}>
                  <button
                    type="button"
                    className={`class-card ${courseClass.archived ? "class-card--archived" : ""}`}
                    onClick={() => navigate(`/teacher/classes/${courseClass._id}`)}
                  >
                    <span className="class-card__main">
                      <span className="class-card__code">
                        {courseClass.courseCode}
                        {courseClass.section ? ` · Section ${courseClass.section}` : ""}
                      </span>
                      <span className="class-card__title">{courseClass.title}</span>
                      <span className="class-card__meta">{roomLabel(courseClass.defaultRoom)}</span>
                    </span>
                    <span className="class-card__side">
                      {courseClass.archived && <Badge variant="neutral">Archived</Badge>}
                      <Badge variant={courseClass.activeStudentCount ? "primary" : "warning"}>
                        {courseClass.activeStudentCount || 0} students
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Create a class" subtitle="Students are added on the next screen.">
          <form className="ui-stack" onSubmit={handleCreateClass}>
            <Field label="Course code" htmlFor="courseCode">
              <input id="courseCode" className="ui-input" required maxLength={40} value={formData.courseCode} onChange={setField("courseCode")} placeholder="CS1501" />
            </Field>
            <Field label="Class title" htmlFor="title">
              <input id="title" className="ui-input" required maxLength={120} value={formData.title} onChange={setField("title")} placeholder="Data Warehousing" />
            </Field>
            <Field label="Section" htmlFor="section" hint="Optional — e.g. A or B.">
              <input id="section" className="ui-input" maxLength={40} value={formData.section} onChange={setField("section")} placeholder="A" />
            </Field>
            <Field label="Room" htmlFor="roomId">
              <RoomPicker
                id="roomId"
                rooms={rooms}
                value={formData.roomId}
                onChange={(roomId) => setFormData((current) => ({ ...current, roomId }))}
                onRoomCreated={(room) => setRooms((current) => [...current, room])}
                required
              />
            </Field>
            {formError && <p className="ui-field__error">{formError}</p>}
            <Button type="submit" loading={saving} disabled={!formData.courseCode.trim() || !formData.title.trim() || !formData.roomId}>
              Create class
            </Button>
          </form>
        </Card>
      </div>

      <Card className="classes-section" title="New-device review queue"
        subtitle="Students who signed in from a different phone. Approve only if you know the change is genuine."
        actions={<Badge variant={reviews.length ? "warning" : "success"}>{reviews.length} pending</Badge>}
      >
        {reviews.length === 0 ? (
          <p className="ui-muted">No students are waiting for a device change review.</p>
        ) : (
          <ul className="review-list">
            {reviews.map((review) => (
              <li key={review._id} className="review-row">
                <span className="review-row__who">
                  <strong>{review.student?.name || "Student"}</strong>
                  <span>{review.student?.email}</span>
                </span>
                <span className="review-row__actions">
                  <Button size="sm" variant="soft" onClick={() => decideReview(review._id, "approved")} disabled={saving}>Approve</Button>
                  <Button size="sm" variant="ghost" onClick={() => decideReview(review._id, "rejected")} disabled={saving}>Reject</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
};

export default ClassManagement;
