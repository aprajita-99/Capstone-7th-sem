import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import { cachedGet, peekCached } from "../../utils/session";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import Sheet from "../../ui/Sheet";
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
  const { user, logout, counts } = useTeacherSession();
  const [showArchived, setShowArchived] = useState(false);
  const classesUrl = `${SERVER_URL}/classes${showArchived ? "?archived=1" : ""}`;
  const roomsUrl = `${SERVER_URL}/rooms`;
  // Last known lists first (page shows at once), refreshed by loadData.
  const [classes, setClasses] = useState(() => peekCached(classesUrl)?.classes ?? null);
  const [rooms, setRooms] = useState(() => peekCached(roomsUrl)?.rooms ?? []);
  const [formData, setFormData] = useState(blankClass);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    const [classesResponse, roomsResponse] = await Promise.all([cachedGet(classesUrl), cachedGet(roomsUrl)]);
    setClasses(classesResponse.data.classes);
    setRooms(roomsResponse.data.rooms);
  }, [classesUrl, roomsUrl]);

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

  if (!user || classes === null) return <PageLoader label="Loading your classes…" />;

  const setField = (field) => (event) => setFormData({ ...formData, [field]: event.target.value });

  return (
    <AppShell
      role="teacher"
      name={user.name || user.email}
      email={user.email}
      onLogout={logout}
      links={teacherLinks("classes", counts)}
    >
      <PageHeader
        title="Classes & rosters"
        subtitle="Create a class once, add its students, and reuse the roster for every check-in."
        actions={<Button onClick={() => setCreating(true)}><Icon name="classes" /> New class</Button>}
      />

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
              icon="classes"
              title={showArchived ? "No classes yet" : "No active classes"}
              text="Create your first class — it takes a few seconds."
              action={<Button variant="soft" onClick={() => setCreating(true)}>New class</Button>}
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

      {creating && (
        <Sheet
          title="Create a class"
          subtitle="Students are added on the next screen."
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" form="create-class-form" loading={saving} disabled={!formData.courseCode.trim() || !formData.title.trim() || !formData.roomId}>
                Create class
              </Button>
            </>
          }
        >
          <form id="create-class-form" className="ui-stack" onSubmit={handleCreateClass}>
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
          </form>
        </Sheet>
      )}
    </AppShell>
  );
};

export default ClassManagement;
