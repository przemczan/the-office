import type {
  SystemHealthBlock,
  SystemHealthPoint,
  SystemHealthRange,
  SystemHealthRead,
} from "@the-office/contracts";
import { Alert, Button, DataTable, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { BlockLoader } from "../../shell/block-loader.tsx";
import { SettingsLink } from "./full-stats.tsx";
import { LineChart, type LineGuide, type TimeTick } from "./line-chart.tsx";
import { SlowestTable, type SlowestRow } from "./slowest-table.tsx";
import { niceStep, OfficeWideBadge, StatsBlock, TableToggle, TipRow } from "./stats-parts.tsx";
import { TRY_AGAIN, UNREACHABLE_TEXT, unreachableWords } from "./stats-words.ts";
import {
  atStepWords,
  BEFORE_THIS_START,
  clockWords,
  countHeadWords,
  countShortWords,
  countWords,
  CPU_AND_MEMORY,
  CPU_AND_MEMORY_NOTE,
  DATABASE,
  DATABASE_FOOT_HOUR,
  DATABASE_FOOT_LONGER,
  EVENT_LOOP_LAG,
  GUIDE_100_MS,
  HEALTH_RANGE_WORDS,
  lagLeadWords,
  LOADING_HEALTH,
  longestWaitWords,
  mbAxisWords,
  mbWords,
  MEASURE_WORDS,
  miniFigureLead,
  msAxisWords,
  msWords,
  NO_FIGURE,
  noQueryWords,
  noRequestWords,
  NOTHING_READ_YET,
  NOTHING_SENT_YET,
  OF_ONE_CORE,
  OF_THE_WORKSTATION,
  OFFICE_CPU,
  OFFICE_MEMORY,
  OPERATION_AND_TABLE,
  P95_TIME,
  percentWords,
  QUERIES_A_MINUTE,
  QUERIES_COLUMN,
  QUERIES_NOUN,
  READING,
  REQUESTS,
  REQUESTS_A_MINUTE,
  REQUESTS_COLUMN,
  REQUESTS_FOOT,
  REQUESTS_NOUN,
  RESPONSIVENESS,
  RESPONSIVENESS_NOTE,
  ROUTE,
  ROUTE_NOUNS,
  SHAPE_NOUNS,
  shortDayWords,
  SLOWEST_QUERIES,
  SLOWEST_QUERIES_BY_TABLE,
  SLOWEST_QUERIES_BY_TABLE_WHEN,
  SLOWEST_QUERIES_WHEN,
  SLOWEST_ROUTES,
  SLOWEST_ROUTES_WHEN,
  STATEMENT_SHAPE,
  STEP,
  stepWords,
  summaryWords,
  TABLE_NOUNS,
  UNMATCHED,
  WAITING_FOR_A_CONNECTION,
  waitedWords,
  WORKSTATION,
  type HealthMeasure,
} from "./system-health-words.ts";

const MB = 1024 * 1024;

/** A measure: its point's figure, its words, its line's colour class, and whether it is shaded. */
interface MeasureSpec {
  readonly value: (point: SystemHealthPoint) => number | null;
  readonly words: (value: number) => string;
  readonly className: string;
  readonly area?: boolean;
}

const megabytes = (bytes: number | null): number | null => (bytes === null ? null : bytes / MB);

const MEASURES: Readonly<Record<HealthMeasure, MeasureSpec>> = {
  lagP99: {
    value: (point) => point.eventLoopLagP99Ms,
    words: msWords,
    className: "stats-tone-2 stats-line-strong",
  },
  lagMax: { value: (point) => point.eventLoopLagMaxMs, words: msWords, className: "stats-tone-4" },
  cpu: {
    value: (point) => point.officeCpuPercent,
    words: percentWords,
    className: "stats-tone-1",
    area: true,
  },
  rss: {
    value: (point) => megabytes(point.memoryInUseBytes),
    words: mbWords,
    className: "stats-tone-2",
  },
  heap: {
    value: (point) => megabytes(point.heapUsedBytes),
    words: mbWords,
    className: "stats-tone-5",
  },
  ws: {
    value: (point) => point.workstationCpuPercent,
    words: percentWords,
    className: "stats-tone-3",
  },
  mem: {
    value: (point) => point.workstationMemoryPercent,
    words: percentWords,
    className: "stats-tone-5",
  },
  req: {
    value: (point) => point.requestsPerMinute,
    words: countWords,
    className: "stats-tone-2",
    area: true,
  },
  reqP95: { value: (point) => point.requestP95Ms, words: msWords, className: "stats-tone-1" },
  q: {
    value: (point) => point.queriesPerMinute,
    words: countWords,
    className: "stats-tone-3",
    area: true,
  },
  qP95: { value: (point) => point.queryP95Ms, words: msWords, className: "stats-tone-1" },
  wait: {
    value: (point) => point.connectionsWaiting,
    words: countWords,
    className: "stats-tone-warning",
  },
};

/** One chart of a block: its title, its measures, its axis and the least its scale reaches. */
interface Mini {
  readonly id: string;
  readonly title: string;
  /** After its figure: "now 23% of one core". */
  readonly unit?: string;
  readonly keys: readonly HealthMeasure[];
  readonly axisWords: (value: number) => string;
  readonly least: number;
  readonly guide?: LineGuide;
  readonly tall?: boolean;
}

const MINIS: Readonly<Record<SystemHealthBlock, readonly Mini[]>> = {
  responsiveness: [
    {
      id: "lag",
      title: EVENT_LOOP_LAG,
      keys: ["lagP99", "lagMax"],
      axisWords: msAxisWords,
      least: 50,
      guide: { value: 100, className: "stats-guide-late", words: GUIDE_100_MS },
      tall: true,
    },
  ],
  "cpu-and-memory": [
    {
      id: "cpu",
      title: OFFICE_CPU,
      unit: OF_ONE_CORE,
      keys: ["cpu"],
      axisWords: percentWords,
      least: 100,
    },
    {
      id: "memory",
      title: OFFICE_MEMORY,
      keys: ["rss", "heap"],
      axisWords: mbAxisWords,
      least: 256,
    },
    {
      id: "workstation",
      title: WORKSTATION,
      keys: ["ws", "mem"],
      axisWords: percentWords,
      least: 100,
    },
  ],
  requests: [
    { id: "req", title: REQUESTS_A_MINUTE, keys: ["req"], axisWords: countShortWords, least: 100 },
    { id: "req-p95", title: P95_TIME, keys: ["reqP95"], axisWords: msAxisWords, least: 50 },
  ],
  database: [
    { id: "q", title: QUERIES_A_MINUTE, keys: ["q"], axisWords: countShortWords, least: 200 },
    { id: "q-p95", title: P95_TIME, keys: ["qP95"], axisWords: msAxisWords, least: 20 },
    {
      id: "wait",
      title: WAITING_FOR_A_CONNECTION,
      keys: ["wait"],
      axisWords: countWords,
      least: 4,
    },
  ],
};

/** What every block of System health reads: the answer's readings for the range, if any yet. */
export interface HealthBlockProps {
  readonly readings: SystemHealthRead | undefined;
  readonly range: SystemHealthRange;
  readonly loading: boolean;
  readonly filtered: boolean;
  readonly onTryAgain: () => void;
  readonly trying: boolean;
}

/** The figures of the points a block draws, each measure's, oldest first. */
function valuesOf(points: readonly SystemHealthPoint[], key: HealthMeasure): (number | null)[] {
  return points.map((point) => MEASURES[key].value(point));
}

function highest(values: readonly (number | null)[]): number | undefined {
  const read = values.filter((value): value is number => value !== null);
  return read.length === 0 ? undefined : Math.max(...read);
}

function latest(values: readonly (number | null)[]): number | undefined {
  return values.findLast((value): value is number => value !== null) ?? undefined;
}

/**
 * The time axis's labels: every 10 minutes on 1 h, every 3 hours on 24 h, each midnight on 7 d and
 * every fifth on 30 d, in the browser's time.
 */
function timeTicksOf(range: SystemHealthRange, from: number, to: number): readonly TimeTick[] {
  const ticks: TimeTick[] = [];
  if (range === "1h") {
    const every = 10 * 60 * 1000;
    for (let at = Math.ceil(from / every) * every; at <= to; at += every) {
      ticks.push({ at, label: clockWords(at) });
    }
    return ticks;
  }
  const next = new Date(from);
  if (range === "24h") {
    next.setMinutes(0, 0, 0);
    while (next.getTime() < from || next.getHours() % 3 !== 0) next.setHours(next.getHours() + 1);
    for (; next.getTime() <= to; next.setHours(next.getHours() + 3)) {
      ticks.push({ at: next.getTime(), label: clockWords(next.getTime()) });
    }
    return ticks;
  }
  next.setHours(24, 0, 0, 0);
  for (; next.getTime() <= to; next.setDate(next.getDate() + (range === "7d" ? 1 : 5))) {
    ticks.push({ at: next.getTime(), label: shortDayWords(next.getTime()) });
  }
  return ticks;
}

/**
 * What is hatched before the first reading: on 1 h, the time before The Office started; on the
 * longer ranges, the time before its first step.
 */
function hatchOf(readings: SystemHealthRead): { to: number; words: string } | undefined {
  const from = Date.parse(readings.from);
  if (readings.readingsSince !== undefined) {
    const since = Date.parse(readings.readingsSince);
    return since > from ? { to: since, words: BEFORE_THIS_START } : undefined;
  }
  const first = readings.points[0];
  if (first === undefined) return undefined;
  const start = Date.parse(first.at) - readings.stepSeconds * 1000;
  return start - from > (readings.stepSeconds * 1000) / 2
    ? { to: start, words: NOTHING_SENT_YET }
    : undefined;
}

/** One chart of a block, with its title, its figure now (1 h) or its highest, and its legend. */
function MiniChart({
  mini,
  readings,
  range,
}: {
  readonly mini: Mini;
  readonly readings: SystemHealthRead;
  readonly range: SystemHealthRange;
}): ReactNode {
  const hour = range === "1h";
  const { points } = readings;
  const series = mini.keys.map((key) => ({
    key,
    className: MEASURES[key].className,
    values: valuesOf(points, key),
    ...(MEASURES[key].area === true && { area: true }),
  }));
  const [lead] = mini.keys;
  const leadValues = series[0]?.values ?? [];
  const figure = lead && (hour ? latest(leadValues) : highest(leadValues));
  const most = Math.max(
    mini.least,
    ...series.flatMap(({ values }) => values.filter((value): value is number => value !== null)),
  );
  const step = niceStep(most / 4);
  const top = Math.max(step, Math.ceil(most / step) * step);
  const axis = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  const from = Date.parse(readings.from);
  const to = Date.parse(readings.to);
  const stepMs = readings.stepSeconds * 1000;
  const summary = summaryWords(
    mini.title,
    HEALTH_RANGE_WORDS[range],
    series.flatMap(({ key, values }) => {
      const at = highest(values);
      return at === undefined
        ? []
        : [{ name: MEASURE_WORDS[key].name, most: MEASURES[key].words(at) }];
    }),
    hour,
  );
  return (
    <div className="stats-mini">
      <div className="stats-mini-head">
        <span className="stats-mini-title">{mini.title}</span>
        {lead && figure !== undefined && (
          <span className="stats-mini-figure">
            {miniFigureLead(hour)} <b>{MEASURES[lead].words(figure)}</b>
            {mini.unit && ` ${mini.unit}`}
          </span>
        )}
      </div>
      {series.length > 1 && (
        <ul className="stats-legend">
          {series.map(({ key, className }) => (
            <li key={key}>
              <i className={`stats-legend-line ${className}`} />
              {MEASURE_WORDS[key].name}
            </li>
          ))}
        </ul>
      )}
      <LineChart
        className={mini.tall ? "stats-health-chart stats-health-tall" : "stats-health-chart"}
        from={from}
        to={to}
        times={points.map(({ at }) => Date.parse(at))}
        series={series}
        top={top}
        axis={axis}
        axisWords={mini.axisWords}
        guides={mini.guide ? [mini.guide] : []}
        hatch={hatchOf(readings)}
        timeTicks={timeTicksOf(range, from, to)}
        gapAfter={stepMs * 1.5}
        summary={summary}
        renderTip={(index) => {
          const point = points[index];
          return (
            point && (
              <PointTip
                mini={mini}
                point={point}
                range={range}
                stepSeconds={readings.stepSeconds}
              />
            )
          );
        }}
      />
    </div>
  );
}

function PointTip({
  mini,
  point,
  range,
  stepSeconds,
}: {
  readonly mini: Mini;
  readonly point: SystemHealthPoint;
  readonly range: SystemHealthRange;
  readonly stepSeconds: number;
}): ReactNode {
  const ofWorkstation = point.officeCpuOfWorkstationPercent;
  return (
    <span className="stats-tip">
      <span className="stats-tip-title">{stepWords(range, Date.parse(point.at), stepSeconds)}</span>
      {mini.keys.map((key) => {
        const value = MEASURES[key].value(point);
        return (
          <TipRow
            key={key}
            className={`stats-legend-line ${MEASURES[key].className}`}
            name={MEASURE_WORDS[key].name}
            value={
              value === null
                ? NO_FIGURE
                : `${MEASURES[key].words(value)}${key === "cpu" ? ` ${OF_ONE_CORE}` : ""}`
            }
          />
        );
      })}
      {mini.keys.includes("cpu") && (
        <TipRow
          name={OF_THE_WORKSTATION}
          value={ofWorkstation === null ? NO_FIGURE : percentWords(ofWorkstation)}
          muted
        />
      )}
    </span>
  );
}

/** A block's figures as one table, one row per reading or step. */
function HealthTable({
  block,
  readings,
  range,
}: {
  readonly block: SystemHealthBlock;
  readonly readings: SystemHealthRead;
  readonly range: SystemHealthRange;
}): ReactNode {
  const keys = MINIS[block].flatMap((mini) => mini.keys);
  const rows = readings.points.map((point) => ({ id: point.at, point }));
  return (
    <div className="stats-table">
      <DataTable<(typeof rows)[number]>
        density="compact"
        stickyHeader
        columns={[
          {
            key: "when",
            header: range === "1h" ? READING : STEP,
            render: (row) => stepWords(range, Date.parse(row.point.at), readings.stepSeconds),
          },
          ...keys.map((key) => ({
            key,
            header: MEASURE_WORDS[key].column,
            align: "right" as const,
            render: (row: (typeof rows)[number]) => {
              const value = MEASURES[key].value(row.point);
              return value === null ? NO_FIGURE : MEASURES[key].words(value);
            },
          })),
        ]}
        rows={rows}
      />
    </div>
  );
}

/** Unreachable's words, on a block whose part of Grafana's answer didn't come. */
function UnansweredAlert({
  address,
  onTryAgain,
  trying,
}: {
  readonly address: string | undefined;
  readonly onTryAgain: () => void;
  readonly trying: boolean;
}): ReactNode {
  return (
    <Alert
      tone="danger"
      title={unreachableWords(address ?? "")}
      action={
        <span className="stats-alert-actions">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="rotate-cw" size={13} />}
            disabled={trying}
            aria-busy={trying || undefined}
            onClick={onTryAgain}
          >
            {TRY_AGAIN}
          </Button>
          <SettingsLink />
        </span>
      }
    >
      {UNREACHABLE_TEXT}
    </Alert>
  );
}

/**
 * A block of System health's charts: its loader until an answer, Unreachable's words when its part
 * of Grafana's answer didn't come, "Nothing read yet" with no reading, else its head figure, its
 * charts or their table, and `extra` under them (a slowest table).
 */
function HealthBlock({
  block,
  title,
  figure,
  note,
  extra,
  props,
}: {
  readonly block: SystemHealthBlock;
  readonly title: string;
  readonly figure?: ReactNode;
  readonly note?: string;
  readonly extra?: ReactNode;
  readonly props: HealthBlockProps;
}): ReactNode {
  const [asTable, setAsTable] = useState(false);
  const { readings, range, loading, filtered, onTryAgain, trying } = props;
  const unanswered = readings?.unansweredBlocks.includes(block) ?? false;
  const empty = readings === undefined || readings.points.length === 0;
  const answered = !loading && readings !== undefined && !unanswered;
  const drawn = answered && !empty;
  return (
    <StatsBlock
      id={`health-${block}`}
      className="stats-span-12"
      title={title}
      badge={<OfficeWideBadge filtered={filtered} />}
      tools={drawn && <TableToggle asTable={asTable} onToggle={() => setAsTable(!asTable)} />}
      loading={false}
      loaderLabel={LOADING_HEALTH}
      foot={answered && note !== undefined && <span className="stats-hint">{note}</span>}
    >
      {loading || readings === undefined ? (
        <>
          <BlockLoader shape="lines" label={LOADING_HEALTH} />
          {extra !== undefined && <BlockLoader shape="rows" label={LOADING_HEALTH} />}
        </>
      ) : unanswered ? (
        <UnansweredAlert address={readings.address} onTryAgain={onTryAgain} trying={trying} />
      ) : empty ? (
        <p className="stats-empty">{NOTHING_READ_YET}</p>
      ) : (
        <>
          {figure && <p className="stats-block-figure">{figure}</p>}
          {asTable ? (
            <HealthTable block={block} readings={readings} range={range} />
          ) : (
            <div className="stats-minis" data-minis={MINIS[block].length}>
              {MINIS[block].map((mini) => (
                <MiniChart key={mini.id} mini={mini} readings={readings} range={range} />
              ))}
            </div>
          )}
          {extra}
        </>
      )}
    </StatsBlock>
  );
}

/** Responsiveness: the event loop lag, p99 and Max, with the 100 ms guide. */
export function ResponsivenessBlock(props: HealthBlockProps): ReactNode {
  const { readings, range } = props;
  let figure: ReactNode;
  const points = readings?.points ?? [];
  const worst = points.reduce<SystemHealthPoint | undefined>(
    (most, point) =>
      point.eventLoopLagMaxMs !== null && point.eventLoopLagMaxMs > (most?.eventLoopLagMaxMs ?? -1)
        ? point
        : most,
    undefined,
  );
  const p99 = valuesOf(points, "lagP99");
  const lead = range === "1h" ? latest(p99) : highest(p99);
  if (readings && lead !== undefined) {
    figure = (
      <>
        <b>{msWords(lead)}</b> {lagLeadWords(range === "1h")}
        {worst && worst.eventLoopLagMaxMs !== null && (
          <>
            {" · "}
            <span
              className={worst.eventLoopLagMaxMs >= 100 ? "stats-tone-text-warning" : undefined}
            >
              {longestWaitWords(
                msWords(worst.eventLoopLagMaxMs),
                atStepWords(range, Date.parse(worst.at), readings.stepSeconds),
              )}
            </span>
          </>
        )}
      </>
    );
  }
  return (
    <HealthBlock
      block="responsiveness"
      title={RESPONSIVENESS}
      figure={figure}
      note={RESPONSIVENESS_NOTE}
      props={props}
    />
  );
}

/** CPU and memory: The Office's CPU, its memory, and the workstation's. */
export function CpuAndMemoryBlock(props: HealthBlockProps): ReactNode {
  return (
    <HealthBlock
      block="cpu-and-memory"
      title={CPU_AND_MEMORY}
      note={CPU_AND_MEMORY_NOTE}
      props={props}
    />
  );
}

/** "18.4k requests in the last hour · p95 46 ms". */
function countFigure(
  count: number,
  noun: string,
  range: SystemHealthRange,
  p95: number | null,
): ReactNode {
  return (
    <>
      <b>{countShortWords(count)}</b>{" "}
      {countHeadWords(noun, range, p95 === null ? NO_FIGURE : msWords(p95))}
    </>
  );
}

/** Requests: requests a minute and their p95 time, then the slowest routes. */
export function RequestsBlock(props: HealthBlockProps): ReactNode {
  const { readings, range } = props;
  const rows: SlowestRow[] = (readings?.slowestRoutes ?? []).map((row) => ({
    id: row.route === null ? "unmatched" : `${row.route.method} ${row.route.template}`,
    what:
      row.route === null ? (
        UNMATCHED
      ) : (
        <>
          <span className="stats-slowest-method">{row.route.method}</span>
          {row.route.template}
        </>
      ),
    ...(row.route === null && { plain: true }),
    count: row.count,
    p95Ms: row.p95Ms,
    maxMs: row.maxMs,
    totalMs: row.totalMs,
  }));
  return (
    <HealthBlock
      block="requests"
      title={REQUESTS}
      figure={
        readings && countFigure(readings.requests, REQUESTS_NOUN, range, readings.requestP95Ms)
      }
      note={REQUESTS_FOOT}
      extra={
        <SlowestTable
          title={SLOWEST_ROUTES}
          when={SLOWEST_ROUTES_WHEN}
          whatHead={ROUTE}
          countHead={REQUESTS_COLUMN}
          rows={rows}
          one={ROUTE_NOUNS.one}
          many={ROUTE_NOUNS.many}
          empty={noRequestWords(range)}
        />
      }
      props={props}
    />
  );
}

/**
 * Database: queries a minute, their p95 time and the most waiting for a connection, then the
 * slowest queries, by statement shape on 1 h, by operation and table on the longer ranges.
 */
export function DatabaseBlock(props: HealthBlockProps): ReactNode {
  const { readings, range } = props;
  const hour = range === "1h";
  const rows: SlowestRow[] = (readings?.slowestQueries ?? []).map((row, index) => ({
    id: `${index}-${row.shape ?? `${row.operation} ${row.table}`}`,
    what:
      hour && row.shape !== undefined ? (
        row.shape
      ) : (
        <>
          <span className="stats-slowest-method">{row.operation}</span>
          {row.table}
        </>
      ),
    count: row.count,
    p95Ms: row.p95Ms,
    maxMs: row.maxMs,
    totalMs: row.totalMs,
  }));
  const most = highest(valuesOf(readings?.points ?? [], "wait")) ?? 0;
  return (
    <HealthBlock
      block="database"
      title={DATABASE}
      figure={
        readings && (
          <>
            {countFigure(readings.queries, QUERIES_NOUN, range, readings.queryP95Ms)}
            {" · "}
            <span className={most > 0 ? "stats-tone-text-warning" : undefined}>
              {waitedWords(most)}
            </span>
          </>
        )
      }
      note={hour ? DATABASE_FOOT_HOUR : DATABASE_FOOT_LONGER}
      extra={
        <SlowestTable
          title={hour ? SLOWEST_QUERIES : SLOWEST_QUERIES_BY_TABLE}
          when={hour ? SLOWEST_QUERIES_WHEN : SLOWEST_QUERIES_BY_TABLE_WHEN}
          whatHead={hour ? STATEMENT_SHAPE : OPERATION_AND_TABLE}
          countHead={QUERIES_COLUMN}
          rows={rows}
          one={(hour ? SHAPE_NOUNS : TABLE_NOUNS).one}
          many={(hour ? SHAPE_NOUNS : TABLE_NOUNS).many}
          empty={noQueryWords(range)}
        />
      }
      props={props}
    />
  );
}
