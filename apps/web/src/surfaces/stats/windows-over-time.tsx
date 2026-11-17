import { Link } from "@tanstack/react-router";
import type {
  FullStatsRead,
  Project,
  StatsEngineWindowsOverTime,
  StatsRunningStageRun,
} from "@the-office/contracts";
import { DataTable, Tooltip } from "@the-office/ui";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  OfficeWideBadge,
  Picker,
  projectColourClass,
  projectColourStyle,
  StatsBlock,
  TableToggle,
  TipRow,
} from "./stats-parts.tsx";
import {
  axisLabel,
  ENGINE,
  FIVE_HOUR_WINDOW,
  GUIDE_100,
  GUIDE_90,
  LOADING_FULL,
  NO_USAGE_WINDOWS,
  NO_WINDOW_READING,
  nothingRanWords,
  RANGE_WORDS,
  runningOnWords,
  SEVEN_DAY_WINDOW,
  STAGE,
  stretchWords,
  TASK,
  WHEN,
  whenLong,
  WINDOWS_OVER_TIME,
} from "./stats-words.ts";

/** A reading of both windows at one instant; a window not read then is undefined. */
interface WindowPoint {
  readonly at: string;
  readonly fiveHour: number | undefined;
  readonly sevenDay: number | undefined;
}

function pointsOf(engine: StatsEngineWindowsOverTime): readonly WindowPoint[] {
  const byAt = new Map<string, { fiveHour?: number; sevenDay?: number }>();
  for (const { at, percentUsed } of engine.fiveHour) {
    byAt.set(at, { ...byAt.get(at), fiveHour: percentUsed });
  }
  for (const { at, percentUsed } of engine.sevenDay) {
    byAt.set(at, { ...byAt.get(at), sevenDay: percentUsed });
  }
  return [...byAt.entries()]
    .toSorted(([first], [second]) => Date.parse(first) - Date.parse(second))
    .map(([at, { fiveHour, sevenDay }]) => ({ at, fiveHour, sevenDay }));
}

/** How full an engine's windows are at the latest reading, the fuller of the two. */
function fullness(engine: StatsEngineWindowsOverTime): number {
  return Math.max(
    engine.fiveHour.at(-1)?.percentUsed ?? 0,
    engine.sevenDay.at(-1)?.percentUsed ?? 0,
  );
}

const percentWords = (value: number | undefined): string =>
  value === undefined ? "–" : `${Math.round(value)}%`;

/** Where an instant sits on the range's time axis, from 0 to 100. */
function axisOf(stats: FullStatsRead): (at: string) => number {
  const from = Date.parse(stats.from);
  const span = Math.max(1, Date.parse(stats.to) - from);
  return (at) => Math.max(0, Math.min(100, ((Date.parse(at) - from) / span) * 100));
}

/**
 * The time axis's labels, at round times in the browser's: every third hour of 24 h, every
 * midnight of 7 d, every fifth of 30 d.
 */
function ticksOf(stats: FullStatsRead): readonly { readonly at: string; readonly x: number }[] {
  const x = axisOf(stats);
  const to = Date.parse(stats.to);
  const first = new Date(stats.from);
  if (stats.range === "24h") {
    first.setMinutes(0, 0, 0);
    first.setHours(Math.ceil((first.getHours() + 1) / 3) * 3);
  } else {
    first.setHours(24, 0, 0, 0);
  }
  const ticks = [];
  while (first.getTime() < to) {
    const iso = first.toISOString();
    ticks.push({ at: iso, x: x(iso) });
    if (stats.range === "24h") first.setHours(first.getHours() + 3);
    else first.setDate(first.getDate() + (stats.range === "7d" ? 1 : 5));
  }
  return ticks;
}

/**
 * The Usage windows over time (spec 2.11, Full stats 5), Office-wide: one engine at a time, the
 * fullest first, its 5-hour and 7-day windows as lines with 90% and 100% marked, and under them the
 * lane of the Stage runs that ran on it, one row per Task in its Project's colour.
 */
export function WindowsOverTime({
  stats,
  loading,
  filtered,
  projects,
}: {
  readonly stats: FullStatsRead | undefined;
  readonly loading: boolean;
  readonly filtered: boolean;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const [engineId, setEngineId] = useState<string | undefined>(undefined);
  const [asTable, setAsTable] = useState(false);
  const shown = loading ? undefined : stats;
  const engines = shown ? shown.windows.toSorted((a, b) => fullness(b) - fullness(a)) : [];
  const picked = engines.find((engine) => engine.engineId === engineId) ?? engines[0];
  const tools = (
    <>
      {engines.length > 1 && picked && (
        <Picker
          label={ENGINE}
          shownLabel
          options={engines.map((engine) => ({ value: engine.engineId, label: engine.name }))}
          value={picked.engineId}
          onChange={setEngineId}
        />
      )}
      {picked && <TableToggle asTable={asTable} onToggle={() => setAsTable(!asTable)} />}
    </>
  );
  return (
    <StatsBlock
      id="windows-over-time"
      className="stats-span-12"
      title={WINDOWS_OVER_TIME}
      badge={<OfficeWideBadge filtered={filtered} />}
      tools={tools}
      loading={shown === undefined}
      loader="lines"
      loaderLabel={LOADING_FULL}
    >
      {shown &&
        (picked === undefined ? (
          <p className="stats-empty">{NO_USAGE_WINDOWS}</p>
        ) : (
          <>
            <WindowLines stats={shown} engine={picked} asTable={asTable} />
            <RunningLane stats={shown} engine={picked} projects={projects} />
          </>
        ))}
    </StatsBlock>
  );
}

function WindowLines({
  stats,
  engine,
  asTable,
}: {
  readonly stats: FullStatsRead;
  readonly engine: StatsEngineWindowsOverTime;
  readonly asTable: boolean;
}): ReactNode {
  const points = pointsOf(engine);
  if (points.length === 0) return <p className="stats-chart-empty">{NO_WINDOW_READING}</p>;
  const latest = points.at(-1);
  return (
    <>
      <ul className="stats-legend">
        <li>
          <i className="stats-line-five" />
          {FIVE_HOUR_WINDOW} <b>{percentWords(latest?.fiveHour)}</b>
        </li>
        <li>
          <i className="stats-line-seven" />
          {SEVEN_DAY_WINDOW} <b>{percentWords(latest?.sevenDay)}</b>
        </li>
        <li>
          <i className="stats-guide-90" />
          {GUIDE_90}
        </li>
        <li>
          <i className="stats-guide-100" />
          {GUIDE_100}
        </li>
      </ul>
      {asTable ? (
        <WindowsTable points={points} />
      ) : (
        <>
          <LinesChart stats={stats} engine={engine} points={points} />
          <TimeTicks stats={stats} className="stats-lines-ticks" />
        </>
      )}
    </>
  );
}

/** The plot's height in the SVG's units, with room above 100% for its guide. */
const PLOT_TOP = 104;

function pathOf(
  points: readonly WindowPoint[],
  key: "fiveHour" | "sevenDay",
  x: (at: string) => number,
): string {
  let path = "";
  let drawing = false;
  for (const point of points) {
    const value = point[key];
    if (value === undefined) {
      drawing = false;
      continue;
    }
    const y = PLOT_TOP - Math.max(0, Math.min(PLOT_TOP, value));
    path += `${drawing ? "L" : "M"}${(x(point.at) * 10).toFixed(1)} ${y.toFixed(1)} `;
    drawing = true;
  }
  return path.trim();
}

/**
 * The two windows as lines on the range's time axis. One tab stop: the arrow keys step from
 * reading to reading (Shift for ten), Home and End go to the first and the last, each reading's
 * Tooltip giving both windows.
 */
function LinesChart({
  stats,
  engine,
  points,
}: {
  readonly stats: FullStatsRead;
  readonly engine: StatsEngineWindowsOverTime;
  readonly points: readonly WindowPoint[];
}): ReactNode {
  const [picked, setPicked] = useState<number | null>(null);
  const x = axisOf(stats);
  const last = points.length - 1;
  const peak = points.reduce<WindowPoint | undefined>(
    (best, point) =>
      point.fiveHour !== undefined &&
      (best?.fiveHour === undefined || point.fiveHour > best.fiveHour)
        ? point
        : best,
    undefined,
  );
  const summary = `How full ${engine.name}'s Usage windows were over the last ${RANGE_WORDS[stats.range]}${
    peak ? `: the 5-hour window at most ${percentWords(peak.fiveHour)} on ${whenLong(peak.at)}` : ""
  }, the 7-day window last ${percentWords(points.at(-1)?.sevenDay)}. Lines mark 90% and 100%. Use the arrow keys to read each point.`;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = picked ?? last;
    const by = event.shiftKey ? 10 : 1;
    const next =
      event.key === "ArrowLeft"
        ? at - by
        : event.key === "ArrowRight"
          ? at + by
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setPicked(Math.max(0, Math.min(last, next)));
  };
  const pickedPoint = picked === null ? undefined : points[picked];
  return (
    <div
      className="stats-lines"
      role="img"
      aria-label={summary}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setPicked((at) => at ?? last)}
      onBlur={() => setPicked(null)}
      onMouseLeave={() => setPicked(null)}
    >
      <div className="stats-lines-axis" aria-hidden="true">
        {[0, 25, 50, 75, 100].map((tick) => (
          <span key={tick} style={{ bottom: `${(tick / PLOT_TOP) * 100}%` }}>
            {tick}%
          </span>
        ))}
      </div>
      <div className="stats-lines-plot">
        <svg viewBox={`0 0 1000 ${PLOT_TOP}`} preserveAspectRatio="none" aria-hidden="true">
          {[0, 25, 50, 75].map((tick) => (
            <line
              key={tick}
              className="stats-lines-grid"
              x1="0"
              x2="1000"
              y1={PLOT_TOP - tick}
              y2={PLOT_TOP - tick}
            />
          ))}
          <line className="stats-guide-90" x1="0" x2="1000" y1={PLOT_TOP - 90} y2={PLOT_TOP - 90} />
          <line
            className="stats-guide-100"
            x1="0"
            x2="1000"
            y1={PLOT_TOP - 100}
            y2={PLOT_TOP - 100}
          />
          <path className="stats-line-seven" d={pathOf(points, "sevenDay", x)} />
          <path className="stats-line-five" d={pathOf(points, "fiveHour", x)} />
          {pickedPoint && (
            <line
              className="stats-lines-cross"
              x1={x(pickedPoint.at) * 10}
              x2={x(pickedPoint.at) * 10}
              y1="0"
              y2={PLOT_TOP}
            />
          )}
        </svg>
        {points.map((point, index) => {
          const left = index === 0 ? 0 : (x(points[index - 1]?.at ?? point.at) + x(point.at)) / 2;
          const right =
            index === last ? 100 : (x(point.at) + x(points[index + 1]?.at ?? point.at)) / 2;
          return (
            <span
              key={point.at}
              className="stats-lines-slot"
              style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
              onMouseEnter={() => setPicked(index)}
            >
              <Tooltip open={picked === index} content={<WindowTip point={point} />}>
                <span className="stats-lines-hit" />
              </Tooltip>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function WindowTip({ point }: { readonly point: WindowPoint }): ReactNode {
  return (
    <span className="stats-tip">
      <span className="stats-tip-title">{whenLong(point.at)}</span>
      <TipRow
        className="stats-line-five"
        name={FIVE_HOUR_WINDOW}
        value={percentWords(point.fiveHour)}
      />
      <TipRow
        className="stats-line-seven"
        name={SEVEN_DAY_WINDOW}
        value={percentWords(point.sevenDay)}
      />
    </span>
  );
}

function WindowsTable({ points }: { readonly points: readonly WindowPoint[] }): ReactNode {
  const rows = points.map((point) => ({ id: point.at, point }));
  return (
    <div className="stats-table">
      <DataTable<(typeof rows)[number]>
        density="compact"
        stickyHeader
        columns={[
          { key: "when", header: WHEN, render: (row) => whenLong(row.point.at) },
          {
            key: "fiveHour",
            header: FIVE_HOUR_WINDOW,
            align: "right",
            render: (row) => percentWords(row.point.fiveHour),
          },
          {
            key: "sevenDay",
            header: SEVEN_DAY_WINDOW,
            align: "right",
            render: (row) => percentWords(row.point.sevenDay),
          },
        ]}
        rows={rows}
      />
    </div>
  );
}

/** The lane's rows: one per Task, in the order each first ran. */
function laneRowsOf(
  runs: readonly StatsRunningStageRun[],
): readonly { readonly taskId: string; readonly runs: readonly StatsRunningStageRun[] }[] {
  const rows = new Map<string, StatsRunningStageRun[]>();
  for (const run of runs) rows.set(run.taskId, [...(rows.get(run.taskId) ?? []), run]);
  return [...rows.entries()].map(([taskId, each]) => ({ taskId, runs: each }));
}

function RunningLane({
  stats,
  engine,
  projects,
}: {
  readonly stats: FullStatsRead;
  readonly engine: StatsEngineWindowsOverTime;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const [asTable, setAsTable] = useState(false);
  const runs = stats.running.filter((run) => run.engineId === engine.engineId);
  const rows = laneRowsOf(runs);
  const projectOf = (projectId: string): Project | undefined =>
    projects?.find(({ id }) => id === projectId);
  const inLane = [...new Set(runs.map(({ projectId }) => projectId))];
  return (
    <div className="stats-lane">
      <div className="stats-lane-head">
        <span className="stats-sub-title">{runningOnWords(engine.name)}</span>
        {runs.length > 0 && <TableToggle asTable={asTable} onToggle={() => setAsTable(!asTable)} />}
        {runs.length > 0 && (
          <ul className="stats-legend">
            {inLane.map((projectId) => (
              <li key={projectId}>
                <i
                  className={`stats-lane-dot ${projectColourClass(projectOf(projectId)) ?? ""}`}
                  style={projectColourStyle(projectOf(projectId))}
                />
                {projectOf(projectId)?.name ?? projectId}
              </li>
            ))}
          </ul>
        )}
      </div>
      {runs.length === 0 ? (
        <p className="stats-empty">{nothingRanWords(engine.name, stats.range)}</p>
      ) : asTable ? (
        <LaneTable runs={runs} />
      ) : (
        <LaneChart stats={stats} rows={rows} projectOf={projectOf} />
      )}
    </div>
  );
}

function LaneChart({
  stats,
  rows,
  projectOf,
}: {
  readonly stats: FullStatsRead;
  readonly rows: ReturnType<typeof laneRowsOf>;
  readonly projectOf: (projectId: string) => Project | undefined;
}): ReactNode {
  const x = axisOf(stats);
  return (
    <div className="stats-lane-chart">
      {rows.map(({ taskId, runs }) => {
        const first = runs[0];
        const project = first && projectOf(first.projectId);
        return (
          <div key={taskId} className="stats-lane-row">
            <span className="stats-lane-label" title={first?.title}>
              <i
                className={`stats-lane-dot ${projectColourClass(project) ?? ""}`}
                style={projectColourStyle(project)}
              />
              <span>{first?.title}</span>
            </span>
            <span className="stats-lane-track">
              {runs.map((run) => {
                const left = x(run.startedAt);
                const right = x(run.endedAt ?? stats.to);
                return (
                  <span
                    key={`${run.stageName}-${run.startedAt}`}
                    className="stats-lane-slot"
                    style={{ left: `${left}%`, width: `max(3px, ${Math.max(0, right - left)}%)` }}
                  >
                    <Tooltip content={<RunTip run={run} />}>
                      <Link
                        to="/tasks/$taskId"
                        params={{ taskId: run.taskId }}
                        className={`stats-lane-bar ${projectColourClass(project) ?? ""}`}
                        style={projectColourStyle(project)}
                        aria-label={`${run.title}, ${run.stageName}, ${stretchWords(run.startedAt, run.endedAt)}`}
                      />
                    </Tooltip>
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
      <TimeTicks stats={stats} className="stats-lane-ticks" />
    </div>
  );
}

/** The time axis's labels under a chart, offset by `className` to the chart's plot. */
function TimeTicks({
  stats,
  className,
}: {
  readonly stats: FullStatsRead;
  readonly className: string;
}): ReactNode {
  return (
    <div className={`stats-time-ticks ${className}`} aria-hidden="true">
      {ticksOf(stats).map(({ at, x: left }) => (
        <span key={at} style={{ left: `${left}%` }}>
          {axisLabel(at, stats.range === "24h")}
        </span>
      ))}
    </div>
  );
}

function RunTip({ run }: { readonly run: StatsRunningStageRun }): ReactNode {
  return (
    <span className="stats-tip">
      <span className="stats-tip-title">{stretchWords(run.startedAt, run.endedAt)}</span>
      <b>{run.title}</b>
      <span>{run.stageName}</span>
    </span>
  );
}

function LaneTable({ runs }: { readonly runs: readonly StatsRunningStageRun[] }): ReactNode {
  const rows = runs.toReversed().map((run) => ({ id: `${run.taskId}-${run.startedAt}`, run }));
  return (
    <div className="stats-table">
      <DataTable<(typeof rows)[number]>
        density="compact"
        stickyHeader
        columns={[
          {
            key: "when",
            header: WHEN,
            render: (row) => stretchWords(row.run.startedAt, row.run.endedAt),
          },
          {
            key: "task",
            header: TASK,
            wrap: true,
            render: (row) => (
              <Link
                to="/tasks/$taskId"
                params={{ taskId: row.run.taskId }}
                className="stats-task-link"
              >
                {row.run.title}
              </Link>
            ),
          },
          { key: "stage", header: STAGE, wrap: true, render: (row) => row.run.stageName },
        ]}
        rows={rows}
      />
    </div>
  );
}
