import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import { cachedGet, peekCached } from "../../utils/session";
import AppShell from "../../ui/AppShell";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import Icon from "../../ui/Icon";
import Field from "../../ui/Field";
import Spinner, { PageLoader } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { useConfirm } from "../../ui/Confirm";
import { downloadFile } from "../../utils/download";
import { roomLabel } from "../../utils/rooms";
import RoomPicker from "./RoomPicker";
import { teacherLinks, useTeacherSession } from "./teacherSession";
import "./classes.css";
import "./reviews.css";
import "../checkin.css";

// The attendance grid loads only when its tab opens.
const ClassAttendance = lazy(() => import("./ClassAttendance"));
const CLASS_TABS = [
  { id: "attendance", label: "Attendance" },
  { id: "checkins", label: "Check-ins" },
  { id: "roster", label: "Roster" },
];

const requestConfig = { withCredentials: true };
const errorMessage = (requestError, fallback) => requestError.response?.data?.message || fallback;
const SAMPLE_CSV = "email,name\n2023ugcs001@nitjsr.ac.in,First Student\n2023ugcs002@nitjsr.ac.in,Second Student\n";
const HEADER_CELLS = ["email", "college email", "student email"];

const downloadSample = () => {
  const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "roster-sample.csv";
  link.click();
  URL.revokeObjectURL(url);
};

// One line per non-empty input row, marked valid / header / error, for the preview.
const previewRows = (rosterText, preview) => {
  const errorsByRow = new Map(preview.errors.filter((entry) => entry.row).map((entry) => [entry.row, entry.message]));
  let seenData = false;
  return rosterText.split(/\r?\n/).flatMap((line, index) => {
    const text = line.trim();
    if (!text) return [];
    const row = index + 1;
    const firstCell = text.split(",")[0].trim().toLowerCase();
    const isHeader = !seenData && HEADER_CELLS.includes(firstCell);
    seenData = true;
    if (isHeader) return [{ row, text, status: "header" }];
    const message = errorsByRow.get(row);
    return [{ row, text, status: message ? "error" : "valid", message }];
  });
};

const IDENTITY_BADGE = {
  verified: { variant: "success", label: "Verified" },
  pending: { variant: "warning", label: "In review" },
  rejected: { variant: "danger", label: "Rejected" },
  none: { variant: "neutral", label: "Not done" },
  not_signed_in: { variant: "neutral", label: "Never signed in" },
};

// Identity enrollment status for one roster row, with the teacher's fixes.
const IdentityCell = ({ info, maxAttempts, busy, onAction }) => {
  if (!info) return <span className="ui-muted">—</span>;
  const badge = IDENTITY_BADGE[info.status] || IDENTITY_BADGE.none;
  const outOfAttempts = ["none", "rejected"].includes(info.status) && info.attempts >= maxAttempts;
  return (
    <span className="identity-cell">
      <Badge variant={outOfAttempts ? "danger" : badge.variant}>{outOfAttempts ? "Out of attempts" : badge.label}</Badge>
      {outOfAttempts && <Button size="sm" variant="soft" disabled={busy} onClick={() => onAction(info, "reset")}>Reset</Button>}
      {info.status === "verified" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction(info, "force")}>Redo</Button>}
    </span>
  );
};

const ClassDetail = () => {
  const { classId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { user, logout, counts } = useTeacherSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = CLASS_TABS.some((item) => item.id === searchParams.get("tab")) ? searchParams.get("tab") : null;

  const classUrl = `${SERVER_URL}/classes/${classId}`;
  // Last known data first (page shows at once), refreshed by loadClass.
  const [courseClass, setCourseClass] = useState(() => peekCached(classUrl)?.courseClass ?? null);
  const [roster, setRoster] = useState(() => peekCached(`${classUrl}/roster`)?.enrollments ?? []);
  const [sessions, setSessions] = useState(() => {
    const saved = peekCached(`${classUrl}/sessions`);
    return saved ? { openSession: saved.openSession, sessions: saved.sessions, loaded: true } : { openSession: null, sessions: [], loaded: false };
  });
  const [identity, setIdentity] = useState(() => {
    const saved = peekCached(`${classUrl}/enrollment-status`);
    return saved ? { statuses: saved.statuses, maxAttempts: saved.maxAttempts } : { statuses: {}, maxAttempts: 3 };
  });
  const [rooms, setRooms] = useState(() => peekCached(`${SERVER_URL}/rooms`)?.rooms ?? []);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: "", section: "", roomId: "" });

  const [filter, setFilter] = useState("");
  const [newStudent, setNewStudent] = useState({ email: "", name: "" });
  const [addError, setAddError] = useState("");

  const [rosterText, setRosterText] = useState("");
  const [preview, setPreview] = useState(null);

  const loadClass = useCallback(async () => {
    // Sessions and identity load alongside the class, not after it.
    const sessionsRequest = cachedGet(`${SERVER_URL}/classes/${classId}/sessions`);
    const identityRequest = cachedGet(`${SERVER_URL}/classes/${classId}/enrollment-status`);
    sessionsRequest.catch(() => {});
    identityRequest.catch(() => {});
    const [classResponse, rosterResponse] = await Promise.all([
      cachedGet(`${SERVER_URL}/classes/${classId}`),
      cachedGet(`${SERVER_URL}/classes/${classId}/roster`),
    ]);
    setCourseClass(classResponse.data.courseClass);
    setRoster(rosterResponse.data.enrollments);
    sessionsRequest
      .then((response) => setSessions({ openSession: response.data.openSession, sessions: response.data.sessions, loaded: true }))
      .catch(() => setSessions((current) => ({ ...current, loaded: true })));
    identityRequest
      .then((response) => setIdentity({ statuses: response.data.statuses, maxAttempts: response.data.maxAttempts }))
      .catch(() => {});
  }, [classId]);

  useEffect(() => {
    if (!user) return;
    loadClass().catch((requestError) => {
      toast(errorMessage(requestError, "Could not load this class."), "error");
      navigate("/teacher/classes");
    });
    cachedGet(`${SERVER_URL}/rooms`).then((response) => setRooms(response.data.rooms)).catch(() => {});
  }, [user, loadClass, navigate, toast]);

  const visibleRoster = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return roster;
    return roster.filter((entry) => `${entry.email} ${entry.name}`.toLowerCase().includes(query));
  }, [roster, filter]);

  const removedByImport = useMemo(() => {
    if (!preview) return [];
    const incoming = new Set(preview.entries.map((entry) => entry.email));
    return roster.filter((entry) => !incoming.has(entry.email));
  }, [preview, roster]);

  if (!user || !courseClass) return <PageLoader label="Loading class…" />;

  const startEditing = () => {
    setEditForm({ title: courseClass.title, section: courseClass.section || "", roomId: courseClass.defaultRoom?._id || "" });
    setEditing(true);
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await axios.patch(`${SERVER_URL}/classes/${classId}`, editForm, requestConfig);
      await loadClass();
      setEditing(false);
      toast("Class updated.", "success");
    } catch (requestError) {
      toast(errorMessage(requestError, "Could not update the class."), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    const archiving = !courseClass.archived;
    if (archiving && !(await confirm({
      title: `Archive ${courseClass.courseCode}?`,
      message: "It will be hidden from your class list and cannot start check-ins. You can restore it later.",
      confirmLabel: "Archive class",
    }))) return;
    setBusy(true);
    try {
      await axios.post(`${SERVER_URL}/classes/${classId}/archive`, { archived: archiving }, requestConfig);
      await loadClass();
      toast(archiving ? "Class archived." : "Class restored.", "success");
    } catch (requestError) {
      toast(errorMessage(requestError, "Could not change the archive state."), "error");
    } finally {
      setBusy(false);
    }
  };

  const addStudent = async (event) => {
    event.preventDefault();
    setBusy(true);
    setAddError("");
    try {
      const response = await axios.post(`${SERVER_URL}/classes/${classId}/roster/students`, newStudent, requestConfig);
      setNewStudent({ email: "", name: "" });
      await loadClass();
      toast(`${response.data.enrollment.email} added.`, "success");
    } catch (requestError) {
      setAddError(errorMessage(requestError, "Could not add this student."));
    } finally {
      setBusy(false);
    }
  };

  const removeStudent = async (entry) => {
    if (!(await confirm({
      title: `Remove ${entry.name || entry.email}?`,
      message: `They will be removed from ${courseClass.courseCode}. Their past attendance stays recorded.`,
      confirmLabel: "Remove student",
    }))) return;
    setBusy(true);
    try {
      await axios.delete(`${SERVER_URL}/classes/${classId}/roster/students/${encodeURIComponent(entry.email)}`, requestConfig);
      await loadClass();
      toast(`${entry.email} removed.`, "success");
    } catch (requestError) {
      toast(errorMessage(requestError, "Could not remove this student."), "error");
    } finally {
      setBusy(false);
    }
  };

  const identityAction = async (info, action) => {
    if (action === "force" && !(await confirm({
      title: "Clear this student's identity check?",
      message: "Their ID and face photos are deleted and they must enroll again.",
      confirmLabel: "Clear and re-enroll",
    }))) return;
    setBusy(true);
    try {
      await axios.post(`${SERVER_URL}/enrollment-reviews/${info.userId}/${action === "force" ? "force-reenroll" : "reset-attempts"}`, {}, requestConfig);
      await loadClass();
      toast(action === "force" ? "The student must enroll again." : "The student can try again.", "success");
    } catch (requestError) {
      toast(errorMessage(requestError, "That did not work."), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRosterText(String(reader.result || ""));
      setPreview(null);
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      const response = await axios.post(`${SERVER_URL}/classes/${classId}/roster/preview`, { rosterText }, requestConfig);
      setPreview(response.data.preview);
    } catch (requestError) {
      toast(errorMessage(requestError, "Could not preview the roster."), "error");
    } finally {
      setBusy(false);
    }
  };

  const saveImport = async () => {
    setBusy(true);
    try {
      const response = await axios.put(`${SERVER_URL}/classes/${classId}/roster`, { rosterText }, requestConfig);
      setRosterText("");
      setPreview(null);
      await loadClass();
      toast(`Roster saved: ${response.data.activeStudentCount} active students.`, "success");
    } catch (requestError) {
      toast(errorMessage(requestError, "Could not save the roster."), "error");
    } finally {
      setBusy(false);
    }
  };

  const rows = preview ? previewRows(rosterText, preview) : [];
  const generalErrors = preview ? preview.errors.filter((entry) => !entry.row) : [];

  // Attendance once the class has a finished check-in, otherwise Roster; ?tab= wins.
  const hasFinished = sessions.sessions.some((session) => session.status !== "open");
  const activeTab = requestedTab || (sessions.loaded ? (hasFinished ? "attendance" : "roster") : null);
  const selectTab = (id) => setSearchParams({ tab: id }, { replace: true });

  const exportSession = async (session) => {
    try {
      await downloadFile(`${SERVER_URL}/sessions/${session._id}/export.csv`, "checkin.csv");
    } catch (requestError) {
      toast("Could not download the CSV.", "error");
    }
  };

  return (
    <AppShell
      role="teacher"
      name={user.name || user.email}
      email={user.email}
      onLogout={logout}
      links={teacherLinks("classes", counts)}
    >
      <PageHeader
        back={{ to: "/teacher/classes", label: "All classes" }}
        eyebrow={`${courseClass.courseCode}${courseClass.section ? ` · Section ${courseClass.section}` : ""}`}
        title={courseClass.title}
        actions={
          <>
            {!courseClass.archived && (sessions.openSession || courseClass.activeStudentCount > 0) && (
              <Button onClick={() => navigate(`/teacher/classes/${classId}/live`)}>
                {sessions.openSession ? "Open live check-in" : "Start check-in"}
              </Button>
            )}
            <Button variant="secondary" onClick={startEditing} disabled={busy}>Edit class</Button>
            {courseClass.archived && (
              <Button variant="soft" onClick={toggleArchive} disabled={busy}>Restore class</Button>
            )}
          </>
        }
      >
        <div className="class-detail__badges">
          <Badge variant="neutral">{roomLabel(courseClass.defaultRoom)}</Badge>
          <Badge variant={courseClass.activeStudentCount ? "primary" : "warning"}>
            {courseClass.activeStudentCount} students
          </Badge>
          {courseClass.archived && <Badge variant="warning" dot>Archived</Badge>}
        </div>
      </PageHeader>

      {editing && (
        <Card className="classes-section" title="Edit class" subtitle="The course code cannot be changed.">
          <form className="edit-grid" onSubmit={saveEdit}>
            <Field label="Class title" htmlFor="edit-title">
              <input id="edit-title" className="ui-input" required maxLength={120} value={editForm.title} onChange={(event) => setEditForm({ ...editForm, title: event.target.value })} />
            </Field>
            <Field label="Section" htmlFor="edit-section">
              <input id="edit-section" className="ui-input" maxLength={40} value={editForm.section} onChange={(event) => setEditForm({ ...editForm, section: event.target.value })} />
            </Field>
            <Field label="Room" htmlFor="edit-room">
              <RoomPicker
                id="edit-room"
                rooms={rooms}
                value={editForm.roomId}
                onChange={(roomId) => setEditForm((current) => ({ ...current, roomId }))}
                onRoomCreated={(room) => setRooms((current) => [...current, room])}
                required
              />
            </Field>
            <div className="edit-grid__actions">
              <Button type="submit" loading={busy}>Save changes</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
          {!courseClass.archived && (
            <div className="edit-archive">
              <div>
                <strong>Archive this class</strong>
                <p className="ui-muted">Hidden from your class list and cannot start check-ins. Its attendance stays; you can restore it later.</p>
              </div>
              <Button variant="secondary" onClick={toggleArchive} disabled={busy}>Archive class</Button>
            </div>
          )}
        </Card>
      )}

      <div className="review-tabs class-tabs" role="tablist" aria-label="Class sections">
        {CLASS_TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id} className={activeTab === item.id ? "is-active" : ""} onClick={() => selectTab(item.id)}>
            {item.label}
            {item.id === "checkins" && sessions.openSession && <Badge variant="info" dot>Live</Badge>}
            {item.id === "roster" && <Badge variant="neutral">{courseClass.activeStudentCount}</Badge>}
          </button>
        ))}
      </div>

      {activeTab === null && <div className="att-loading"><Spinner /></div>}

      {activeTab === "attendance" && (
        <Suspense fallback={<div className="att-loading"><Spinner /> <span className="ui-muted">Loading attendance…</span></div>}>
          <ClassAttendance classId={classId} />
        </Suspense>
      )}

      {activeTab === "roster" && (
      <>
      <Card className="classes-section" title="Roster" subtitle="Only students on this list can sign in and check in to this class."
        actions={roster.length > 8 && (
          <input className="ui-input roster-filter" placeholder="Search name or email" value={filter} onChange={(event) => setFilter(event.target.value)} />
        )}
      >
        <form className="add-student" onSubmit={addStudent}>
          <input className="ui-input" type="email" required placeholder="2023ugcs001@nitjsr.ac.in" value={newStudent.email} onChange={(event) => setNewStudent({ ...newStudent, email: event.target.value })} aria-label="Student email" />
          <input className="ui-input" placeholder="Name (optional)" maxLength={120} value={newStudent.name} onChange={(event) => setNewStudent({ ...newStudent, name: event.target.value })} aria-label="Student name" />
          <Button type="submit" variant="soft" loading={busy} disabled={!newStudent.email.trim()}>Add student</Button>
        </form>
        {addError && <p className="ui-field__error add-student__error">{addError}</p>}

        {roster.length === 0 ? (
          <EmptyState icon="users" title="No students yet" text="Add students one by one above, or import the whole class from a CSV below." />
        ) : (
          <div className="roster-table-wrap">
            <table className="roster-table">
              <thead>
                <tr><th>Roll</th><th>Name</th><th>Email</th><th>Batch</th><th>Identity</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {visibleRoster.map((entry) => (
                  <tr key={entry._id}>
                    <td className="roster-table__roll" data-label="Roll">{entry.identity?.rollNumber || "—"}</td>
                    <td className="roster-table__name" data-label="Name">{entry.name || <span className="ui-muted">—</span>}</td>
                    <td className="roster-table__email" data-label="Email">{entry.email}</td>
                    <td className="roster-table__batch" data-label="Batch">{entry.identity?.batch ? `${entry.identity.batch} ${entry.identity.programmeBranch || ""}` : "—"}</td>
                    <td className="roster-table__identity" data-label="Identity"><IdentityCell info={identity.statuses[entry.email]} maxAttempts={identity.maxAttempts} busy={busy} onAction={identityAction} /></td>
                    <td className="roster-table__actions">
                      <Button size="sm" variant="ghost" onClick={() => removeStudent(entry)} disabled={busy}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleRoster.length === 0 && <p className="ui-muted roster-table__none">No students match “{filter}”.</p>}
          </div>
        )}
      </Card>

      <Card className="classes-section" title="Import from CSV"
        subtitle="Replaces the whole roster. One email per line (any domain), or email,name. Students missing from the file are removed from this class."
        actions={<Button size="sm" variant="ghost" onClick={downloadSample}>Download sample CSV</Button>}
      >
        <div className="ui-stack">
          <input type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} aria-label="Choose CSV file" />
          <textarea
            className="ui-textarea"
            rows={8}
            value={rosterText}
            onChange={(event) => { setRosterText(event.target.value); setPreview(null); }}
            placeholder={"email,name\n2023ugcs001@nitjsr.ac.in,First Student"}
            aria-label="Roster CSV"
          />
          <div className="import-actions">
            <Button variant="secondary" onClick={runPreview} loading={busy && !preview} disabled={!rosterText.trim() || busy}>Preview</Button>
            <Button onClick={saveImport} disabled={busy || !preview || preview.errors.length > 0 || preview.entries.length === 0}>Save roster</Button>
          </div>

          {preview && (
            <div className="import-preview">
              <div className="import-preview__summary">
                <Badge variant="success">{preview.entries.length} valid</Badge>
                <Badge variant={preview.errors.length ? "danger" : "neutral"}>{preview.errors.length} errors</Badge>
                {removedByImport.length > 0 && (
                  <Badge variant="warning">{removedByImport.length} current students will be removed</Badge>
                )}
              </div>
              {preview.errors.length > 0 && <p className="ui-field__error">Fix the highlighted rows, then preview again. Saving is blocked while there are errors.</p>}
              {generalErrors.map((entry) => <p key={entry.message} className="ui-field__error">{entry.message}</p>)}
              <ol className="import-rows">
                {rows.slice(0, 300).map((row) => (
                  <li key={row.row} className={`import-row import-row--${row.status}`}>
                    <span className="import-row__num">{row.row}</span>
                    <span className="import-row__text">{row.text}</span>
                    <span className="import-row__status">
                      {row.status === "valid" && <Icon name="check" size={14} label="Valid" />}
                      {row.status === "header" && "header"}
                      {row.status === "error" && row.message}
                    </span>
                  </li>
                ))}
              </ol>
              {rows.length > 300 && <p className="ui-muted">Showing the first 300 rows.</p>}
            </div>
          )}
        </div>
      </Card>
      </>
      )}

      {activeTab === "checkins" && (
      <Card className="classes-section" title="Check-in sessions"
        subtitle="Start a check-in on the phone you will leave at the front of the room."
        actions={
          <Button onClick={() => navigate(`/teacher/classes/${classId}/live`)} disabled={courseClass.archived || (!sessions.openSession && courseClass.activeStudentCount === 0)}>
            {sessions.openSession ? "Open live check-in" : "Start check-in"}
          </Button>
        }
      >
        {courseClass.activeStudentCount === 0 && !sessions.openSession && <p className="ui-muted">Add students to the roster before taking attendance.</p>}
        {sessions.sessions.length === 0 ? (
          <EmptyState icon="sound" title="No check-ins yet" text="Each check-in you run appears here with its present, review and absent counts." />
        ) : (
          <ul className="session-list">
            {sessions.sessions.map((session) => (
              <li key={session._id} className="session-item">
                <button type="button" className="session-row session-row--button" onClick={() => navigate(session.status === "open" ? `/teacher/classes/${classId}/live` : `/teacher/sessions/${session._id}`)}>
                <span className="session-row__when">
                  <strong>{new Date(session.startedAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</strong>
                  <span>{new Date(session.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · {session.settings?.windowMin} min window</span>
                </span>
                <span className="session-row__stats">
                  {session.status === "open" ? (
                    <Badge variant="info" dot>Open now</Badge>
                  ) : (
                    <>
                      <Badge variant="success">{session.stats?.present ?? 0} present</Badge>
                      <Badge variant="warning">{session.stats?.review ?? 0} review</Badge>
                      <Badge variant="neutral">{session.stats?.absent ?? 0} absent</Badge>
                    </>
                  )}
                </span>
                </button>
                {session.status !== "open" && (
                  <Button size="sm" variant="ghost" className="session-item__csv" onClick={() => exportSession(session)} aria-label="Download this check-in as CSV">CSV</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}
    </AppShell>
  );
};

export default ClassDetail;
