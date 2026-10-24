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
  roll: { label: "Roll no", compare: (left, right) => left.loginId.localeCompare(right.loginId) },
  low: { label: "Lowest % first", compare: (left, right) => (left.percent ?? 101) - (right.percent ?? 101) || left.loginId.localeCompare(right.loginId) },
  name: { label: "Name", compare: (left, right) => (left.name || left.loginId).localeCompare(right.name || right.loginId) },
};

const percentText = (row) => (row.percent === null ? "—" : `${row.percent}%`);
const rollText = (row) => row.loginId.toUpperCase();
const attendedText = (row) => `${row.present}/${row.counted}`;
const cellLabel = (cell) => (cell.implicit ? "Absent — before joining the roster" : CELL[cell.status]?.label);
const dateLabel = (value) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const timeLabel = (value) => new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

// % with a marker when below the minimum (monochrome: weight + icon, not colour).
const PercentCell = ({ row }) => (
  <span className={`att-table__pct att-table__pct--${row.band}`}>
    {row.band === "low" && <Icon name="warning" size={13} label="Below 75%" />}
    {percentText(row)}
  </span>
);

// Phone: a plain roll-wise table (Roll no · Name · Attended · %); tapping a row opens the history.
const AttendanceTable = ({ rows, onOpen }) => (
  <div className="att-table-wrap">
    <table className="att-table">
      <thead>
        <tr>
          <th scope="col">Roll no</th>
          <th scope="col">Name</th>
          <th scope="col" className="att-table__num">Attended</th>
          <th scope="col" className="att-table__num">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.email} className={`att-table__row--${row.band}`} onClick={() => onOpen(row)}>
            <td className="att-table__roll">{rollText(row)}</td>
            <td className="att-table__name">
              <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(row); }} aria-label={`History of ${row.name || row.loginId}`}>
                {row.name || "—"}
              </button>
              {row.pending > 0 && <span className="att-table__pending">{row.pending} in review</span>}
            </td>
            <td className="att-table__num">{attendedText(row)}</td>
            <td className="att-table__num"><PercentCell row={row} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// Desktop: students × check-ins with a sticky name column.
const Matrix = ({ rows, sessions, onCell }) => (
  <div className="att-matrix-wrap">
    <table className="att-matrix">
      <thead>
        <tr>
          <th className="att-matrix__name" scope="col">Student</th>
          <th className="att-matrix__attended" scope="col">Attended</th>
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
              <span>{rollText(row)}</span>
            </th>
            <td className="att-matrix__attended">{attendedText(row)}</td>
            <td className="att-matrix__pct"><PercentCell row={row} /></td>
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
  const [sort, setSort] = useState("roll");
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
            <AttendanceTable rows={rows} onOpen={setOpenRow} />
          )}

          <p className="class-att__legend ui-muted">
            {wide && (
              <>
                <span className="att-cell att-cell--P">P</span> present · <span className="att-cell att-cell--A">A</span> absent ·{" "}
                <span className="att-cell att-cell--R">R</span> in review (not counted yet) · <span className="att-cell att-cell--A att-cell--implicit">–</span> before joining the roster (counts as absent).{" "}
              </>
            )}
            Attended = present out of check-ins counted; cases in review are not counted until decided. <Icon name="warning" size={13} /> marks students below {minPercent}%.
            {!wide && " Tap a student for their full history."}
          </p>

          {removed.length > 0 && (
            <details className="class-att__removed">
              <summary>Removed students ({removed.length})</summary>
              <AttendanceTable rows={[...removed].sort(SORTS.roll.compare)} onOpen={setOpenRow} />
            </details>
          )}
        </>
      )}

      {openRow && <HistorySheet row={openRow} sessions={sessions} onCell={openCell} onClose={() => setOpenRow(null)} />}
    </div>
  );
};

export default ClassAttendance;
