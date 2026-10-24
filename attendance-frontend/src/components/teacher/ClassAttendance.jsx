import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import Sheet from "../../ui/Sheet";
import Spinner from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { downloadFile } from "../../utils/download";
import useMediaQuery from "../../utils/useMediaQuery";

const CELL = {
  P: { label: "Present", short: "P" },
  A: { label: "Absent", short: "A" },
  R: { label: "In review — not counted yet", short: "R" },
  "-": { label: "Not on the roster", short: "" },
};
const SORTS = {
  low: { label: "Lowest % first", compare: (left, right) => (left.percent ?? 101) - (right.percent ?? 101) || left.loginId.localeCompare(right.loginId) },
  roll: { label: "Roll", compare: (left, right) => left.loginId.localeCompare(right.loginId) },
  name: { label: "Name", compare: (left, right) => (left.name || left.loginId).localeCompare(right.name || right.loginId) },
};

const percentText = (row) => (row.percent === null ? "—" : `${row.percent}%`);
const cellLabel = (cell) => (cell.implicit ? "Absent — before joining the roster" : CELL[cell.status]?.label);
const dateLabel = (value) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const timeLabel = (value) => new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const PercentBar = ({ row }) => (
  <span className={`att-pct att-pct--${row.band}`}>
    <span className="att-pct__track"><span style={{ width: `${row.percent ?? 0}%` }} /></span>
    <strong>{percentText(row)}</strong>
  </span>
);

// Phone: one row per student with %, bar and the last 10 check-ins as dots.
const StudentRow = ({ row, onOpen }) => (
  <li>
    <button type="button" className={`att-row att-row--${row.band}`} onClick={() => onOpen(row)}>
      <span className="att-row__who">
        <strong>{row.name || row.loginId}</strong>
        <span className="ui-muted">{row.loginId}{row.pending ? ` · ${row.pending} in review` : ""}</span>
      </span>
      <PercentBar row={row} />
      <span className="att-dots" aria-hidden="true">
        {row.cells.slice(-10).map((cell) => (
          <span key={cell.sessionId} className={`att-dot att-dot--${cell.status === "-" ? "none" : cell.status}${cell.implicit ? " att-dot--implicit" : ""}`} />
        ))}
      </span>
    </button>
  </li>
);

// Desktop: students × check-ins with a sticky name column.
const Matrix = ({ rows, sessions, onCell }) => (
  <div className="att-matrix-wrap">
    <table className="att-matrix">
      <thead>
        <tr>
          <th className="att-matrix__name" scope="col">Student</th>
          <th className="att-matrix__pct" scope="col">%</th>
          {sessions.map((session) => (
            <th key={session._id} scope="col" className="att-matrix__date">
              <span>{dateLabel(session.startedAt)}</span>
              <small>{timeLabel(session.startedAt)}{session.locked ? <Icon name="lock" size={11} label="Locked" className="att-matrix__lock" /> : null}</small>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.email} className={`att-matrix__row--${row.band}`}>
            <th scope="row" className="att-matrix__name">
              <strong>{row.name || row.loginId}</strong>
              <span>{row.loginId}</span>
            </th>
            <td className="att-matrix__pct"><PercentBar row={row} /></td>
            {row.cells.map((cell) => (
              <td key={cell.sessionId}>
                {cell.recordId ? (
                  <button type="button" className={`att-cell att-cell--${cell.status}`} title={`${cellLabel(cell)} — open this check-in`} onClick={() => onCell(cell, row)}>
                    {CELL[cell.status].short}
                  </button>
                ) : (
                  <span className={`att-cell att-cell--${cell.status === "-" ? "none" : cell.status}${cell.implicit ? " att-cell--implicit" : ""}`} title={cellLabel(cell)}>
                    {cell.status === "-" ? "" : "–"}
                  </span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const HistorySheet = ({ row, sessions, onCell, onClose }) => (
  <Sheet title={row.name || row.loginId} subtitle={`${row.loginId} · ${percentText(row)} · ${row.present} of ${row.counted} attended${row.pending ? ` · ${row.pending} in review` : ""}`} onClose={onClose}>
    <ul className="att-history">
      {[...row.cells].reverse().map((cell) => {
        const session = sessions.find((item) => item._id === cell.sessionId);
        return (
          <li key={cell.sessionId}>
            <span className="att-history__when">
              <strong>{session ? dateLabel(session.startedAt) : ""}</strong>
              <span className="ui-muted">{session ? timeLabel(session.startedAt) : ""}</span>
            </span>
            <span className={`att-cell att-cell--${cell.status === "-" ? "none" : cell.status}${cell.implicit ? " att-cell--implicit" : ""}`}>{cell.implicit ? "–" : CELL[cell.status].short}</span>
            <span className="att-history__label">{cellLabel(cell)}</span>
            {cell.recordId && <Button size="sm" variant="ghost" onClick={() => onCell(cell, row)}>Open</Button>}
          </li>
        );
      })}
    </ul>
  </Sheet>
);

/**
 * Class → Attendance tab (Phase 11): % per student over closed and locked
 * check-ins, review cases shown but not counted, late joiners absent for
 * earlier check-ins, removed students apart, CSV export.
 */
const ClassAttendance = ({ classId }) => {
  const navigate = useNavigate();
  const toast = useToast();
  const wide = useMediaQuery("(min-width: 760px)");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("low");
  const [openRow, setOpenRow] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    setError("");
    axios
      .get(`${SERVER_URL}/classes/${classId}/attendance`, { withCredentials: true })
      .then((response) => setData(response.data))
      .catch((requestError) => setError(requestError.response?.data?.message || "Could not load attendance."));
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const search = query.trim().toLowerCase();
    return data.students
      .filter((row) => !search || `${row.name} ${row.email} ${row.loginId}`.toLowerCase().includes(search))
      .sort(SORTS[sort].compare);
  }, [data, query, sort]);

  const openCell = (cell, row) => navigate(`/teacher/sessions/${cell.sessionId}?student=${encodeURIComponent(row.email)}`);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile(`${SERVER_URL}/classes/${classId}/attendance.csv`, "attendance.csv");
    } catch (requestError) {
      toast("Could not download the CSV.", "error");
    } finally {
      setExporting(false);
    }
  };

  if (error) return <EmptyState icon="alert" title="Attendance unavailable" text={error} action={<Button variant="soft" onClick={load}>Try again</Button>} />;
  if (!data) return <div className="att-loading"><Spinner /> <span className="ui-muted">Loading attendance…</span></div>;

  const { summary, sessions, removed, minPercent } = data;

  return (
    <div className="class-att">
      <div className="class-att__summary">
        <div className="class-att__stat"><strong>{summary.counted}</strong><span>check-ins counted</span></div>
        <div className="class-att__stat"><strong>{summary.average === null ? "—" : `${summary.average}%`}</strong><span>class average</span></div>
        <div className={`class-att__stat ${summary.below ? "class-att__stat--low" : ""}`}><strong>{summary.below}</strong><span>below {minPercent}%</span></div>
        <div className={`class-att__stat ${summary.pending ? "class-att__stat--pending" : ""}`}><strong>{summary.pending}</strong><span>in review</span></div>
      </div>

      {data.openSession && <Badge variant="info" dot>A check-in is live now — it counts once it closes.</Badge>}

      {summary.counted === 0 ? (
        <EmptyState icon="chart" title="No attendance yet" text="Closed check-ins appear here with each student's percentage." />
      ) : (
        <>
          <div className="class-att__bar">
            <input className="ui-input class-att__search" placeholder="Search name or roll" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search students" />
            <select className="ui-input class-att__sort" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort students">
              {Object.entries(SORTS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
            </select>
            <Button variant="secondary" loading={exporting} onClick={exportCsv}><Icon name="download" /> Export CSV</Button>
          </div>

          {rows.length === 0 ? (
            <p className="ui-muted">No students match “{query}”.</p>
          ) : wide ? (
            <Matrix rows={rows} sessions={sessions} onCell={openCell} />
          ) : (
            <ul className="att-list">{rows.map((row) => <StudentRow key={row.email} row={row} onOpen={setOpenRow} />)}</ul>
          )}

          <p className="class-att__legend ui-muted">
            <span className="att-cell att-cell--P">P</span> present · <span className="att-cell att-cell--A">A</span> absent ·{" "}
            <span className="att-cell att-cell--R">R</span> in review (not counted yet) · <span className="att-cell att-cell--A att-cell--implicit">–</span> before joining the roster (counts as absent).
            {" "}Below {minPercent}% is red, below 85% amber.
          </p>

          {removed.length > 0 && (
            <details className="class-att__removed">
              <summary>Removed students ({removed.length})</summary>
              <ul className="att-list">{removed.map((row) => <StudentRow key={row.email} row={row} onOpen={setOpenRow} />)}</ul>
            </details>
          )}
        </>
      )}

      {openRow && <HistorySheet row={openRow} sessions={sessions} onCell={openCell} onClose={() => setOpenRow(null)} />}
    </div>
  );
};

export default ClassAttendance;
