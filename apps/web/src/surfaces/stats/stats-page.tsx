import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BASIC_STATS_DAYS,
  countedTokens,
  type BasicStats,
  type FullStatsSplit,
  type Project,
  type StatsDay,
  type StatsEngine,
  type StatsTopTask,
} from "@the-office/contracts";
import { Alert, DataTable, Icon, Skeleton } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { statsQueries, telemetryQueries } from "../../api/telemetry.ts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import {
  meterFilled,
  percentWords,
  usageTone,
  type UsageWindow,
} from "../../shell/notifications/now-words.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { TokenCount } from "../../shell/token-count.tsx";
import { NO_TOKENS, sumTokens } from "../../shell/token-words.ts";
import {
  CoverageLine,
  FullStatsAlert,
  FullStatsBlocks,
  RangePicker,
  SettingsLink,
  useStatsRange,
} from "./full-stats.tsx";
import {
  BarsChart,
  OfficeWideBadge,
  projectColourClass,
  projectColourStyle,
  StatsBlock,
  TableToggle,
  TipRow,
} from "./stats-parts.tsx";
import {
  CACHE_READS,
  DAY,
  dayLabel,
  dayLong,
  ENVIRONMENT_STEP,
  FIVE_HOUR_WINDOW,
  FULL_STATS,
  FULL_STATS_ADD,
  KIND_NAMES,
  LOADING,
  MESSAGE_WORDS,
  NO_USAGE_WINDOWS,
  NOT_READ_YET,
  SEVEN_DAY_WINDOW,
  sinceWords,
  STAGE_RETRIES,
  STAGE_RETRIES_TEXT,
  STATS_SUB,
  STATS_TITLE,
  statsMessageOf,
  TASKS_DONE,
  TASKS_DONE_TEXT,
  THIS_WEEK,
  TODAY,
  TOKENS_IN_DAYS,
  TOKENS_PER_DAY,
  TOP_TASKS,
  TOP_TASKS_EMPTY,
  TOP_TASKS_HINT,
  TOTAL,
  USAGE_WINDOWS_NOW,
  windowResetWords,
  type StatsMessage,
} from "./stats-words.ts";
import "./stats.css";

/**
 * Stats (spec 2.11): the basic stats, from what The Office already keeps, always; and the full
 * stats from Grafana once it answers, with the range in the address. Tokens per day and the Usage
 * windows are Office-wide; the rest follows the Project filter. Each is read when the page opens and
 * every minute while it is open, the full stats every few seconds while Grafana starts.
 */
export function StatsPage(): ReactNode {
  const { filter } = useProjectFilter();
  const [range, setRange] = useStatsRange();
  const [split, setSplit] = useState<FullStatsSplit>("model");
  const stats = useQuery(statsQueries.basic(filter));
  const full = useQuery({
    ...statsQueries.full(filter, range, split),
    placeholderData: keepPreviousData,
  });
  const telemetry = useQuery(telemetryQueries.settings());
  const projects = useQuery(projectQueries.list());
  const filtered = filter !== "all";
  const message = telemetry.data ? statsMessageOf(telemetry.data) : null;
  const answered = full.data;
  // Until the first answer, the full stats' loaders show where a Grafana is chosen.
  const showsFull =
    answered?.state === "full" ||
    (answered === undefined && !full.error && telemetry.data !== undefined && message === null);
  const fullLoading = answered === undefined || full.isPlaceholderData;
  const showsMessage = message !== null && (answered === undefined || answered.state === "not-on");
  const basicLoading = !stats.data && !stats.error;
  const windowsNow = (className: string): ReactNode => (
    <StatsBlock
      id="windows-now"
      className={className}
      title={USAGE_WINDOWS_NOW}
      badge={<OfficeWideBadge filtered={filtered} />}
      loading={basicLoading}
      loaderLabel={LOADING}
    >
      {stats.data && <UsageWindowsNow engines={stats.data.engines} />}
    </StatsBlock>
  );
  const thisWeek = (className: string): ReactNode => (
    <StatsBlock
      id="week"
      className={className}
      title={THIS_WEEK}
      when={stats.data && sinceWords(stats.data.weekStartsAt)}
      loading={basicLoading}
      loaderLabel={LOADING}
    >
      {stats.data && <ThisWeek stats={stats.data} />}
    </StatsBlock>
  );
  return (
    <div className="stats-page">
      <div className="stats-page-head">
        <div className="stats-page-words">
          <h2 className="stats-page-title">{STATS_TITLE}</h2>
          <p className="stats-page-sub">{STATS_SUB}</p>
        </div>
        {showsFull && <RangePicker range={range} onChange={setRange} />}
      </div>
      {showsFull &&
        (fullLoading ? (
          <Skeleton width={340} height={12} style={{ maxWidth: "100%" }} />
        ) : (
          <CoverageLine />
        ))}
      {answered && (
        <FullStatsAlert
          stats={answered}
          onTryAgain={() => void full.refetch()}
          trying={full.isFetching}
        />
      )}
      {full.error && <Alert tone="danger" title={full.error.message} />}
      {stats.error && <Alert tone="danger" title={stats.error.message} />}
      <div className="stats-blocks">
        {showsFull ? (
          <>
            <FullStatsBlocks
              stats={answered?.state === "full" ? answered : undefined}
              loading={fullLoading}
              range={range}
              split={split}
              onSplit={setSplit}
              filtered={filtered}
              projects={projects.data}
            />
            {windowsNow("stats-span-6")}
            {thisWeek("stats-span-6")}
          </>
        ) : (
          <>
            <StatsBlock
              id="days"
              className="stats-span-8"
              title={TOKENS_PER_DAY}
              badge={<OfficeWideBadge filtered={filtered} />}
              loading={basicLoading}
              loaderLabel={LOADING}
            >
              {stats.data && <TokensPerDay days={stats.data.days} />}
            </StatsBlock>
            {windowsNow("stats-span-4")}
            <StatsBlock
              id="top"
              className="stats-span-8"
              title={TOP_TASKS}
              when={stats.data && sinceWords(stats.data.weekStartsAt)}
              loading={basicLoading}
              loaderLabel={LOADING}
              foot={
                <span className="stats-hint">
                  <Icon name="info" size={12} />
                  {TOP_TASKS_HINT}
                </span>
              }
            >
              {stats.data && <TopTasks tasks={stats.data.topTasks} projects={projects.data} />}
            </StatsBlock>
            {thisWeek("stats-span-4")}
            {showsMessage && message !== null && <FullStatsMessage message={message} />}
          </>
        )}
      </div>
    </div>
  );
}

/** The kinds a day stacks, bottom first, each in its chart colour (stats.css). */
const KINDS = ["input", "output", "cacheCreation"] as const;

function TokensPerDay({ days }: { readonly days: readonly StatsDay[] }): ReactNode {
  const [asTable, setAsTable] = useState(false);
  const all = sumTokens(days.map(({ tokens }) => tokens));
  const today = days.at(-1)?.tokens ?? NO_TOKENS;
  return (
    <>
      <div className="stats-days-head">
        <p className="stats-figure">
          <TokenCount tokens={all} label={TOKENS_IN_DAYS(BASIC_STATS_DAYS)} strong />
          <span aria-hidden="true">·</span>
          <TokenCount tokens={today} label={TODAY} strong />
        </p>
        <TableToggle asTable={asTable} onToggle={() => setAsTable(!asTable)} />
      </div>
      <ul className="stats-legend">
        {KINDS.map((kind) => (
          <li key={kind}>
            <i className={`stats-kind-${kind}`} />
            {KIND_NAMES[kind]} <b>{tokensShort(all[kind])}</b>
          </li>
        ))}
        <li className="stats-muted">
          <i className="stats-kind-cacheRead" />
          {CACHE_READS} <b>{tokensShort(all.cacheRead)}</b>
        </li>
      </ul>
      {asTable ? <DaysTable days={days} /> : <DaysChart days={days} />}
    </>
  );
}

/** The tokens an empty chart's axis is drawn as reaching, so it reads as a scale of tokens. */
const EMPTY_AXIS_TOKENS = 100_000;

/** Of the 30 days, every how many has a label under the chart, so the labels don't crowd. */
const LABEL_EVERY = 5;

/**
 * The 30 days stacked by kind, the cache reads in their own strip under them, each day's Tooltip
 * giving all four kinds and its total.
 */
function DaysChart({ days }: { readonly days: readonly StatsDay[] }): ReactNode {
  const counted = days.map(({ tokens }) => countedTokens(tokens));
  const most = Math.max(0, ...counted);
  const reads = days.reduce((sum, { tokens }) => sum + tokens.cacheRead, 0);
  const last = days.length - 1;
  const busiest = counted.indexOf(most);
  const summary = `${TOKENS_PER_DAY}, the last ${days.length} office days: ${tokensShort(
    counted.reduce((sum, count) => sum + count, 0),
  )} in all${
    busiest >= 0 && most > 0
      ? `, the most on ${dayLong(days[busiest]?.day ?? "")} with ${tokensShort(most)}`
      : ""
  }, ${tokensShort(counted[last] ?? 0)} today. Cache reads, ${tokensShort(
    reads,
  )}, are drawn apart and not counted. Use the arrow keys to read each day.`;
  return (
    <BarsChart
      steps={days.map((day, index) => {
        const fromToday = last - index;
        const labelled = fromToday % LABEL_EVERY === 0;
        return {
          key: day.day,
          label: labelled ? dayLabel(day.day) : "",
          // Every other label gives way on a narrow chart, so the ones left don't run together.
          minor: labelled && fromToday % (2 * LABEL_EVERY) !== 0,
          tip: <DayTip day={day} today={index === last} />,
        };
      })}
      stacks={days.map((day) =>
        KINDS.map((kind) => ({ className: `stats-kind-${kind}`, value: day.tokens[kind] })),
      )}
      axisWords={tokensShort}
      emptyTop={EMPTY_AXIS_TOKENS}
      summary={summary}
      under={{
        label: `${CACHE_READS} · ${tokensShort(reads)} in ${days.length} days`,
        values: days.map(({ tokens }) => tokens.cacheRead),
      }}
    />
  );
}

function DayTip({ day, today }: { readonly day: StatsDay; readonly today: boolean }): ReactNode {
  return (
    <span className="stats-tip">
      <span className="stats-tip-title">
        {dayLong(day.day)}
        {today && ` · ${TODAY}`}
      </span>
      {KINDS.map((kind) => (
        <TipRow
          key={kind}
          className={`stats-kind-${kind}`}
          name={KIND_NAMES[kind]}
          value={tokensShort(day.tokens[kind])}
        />
      ))}
      <TipRow name={TOTAL} value={tokensShort(countedTokens(day.tokens))} total />
      <TipRow
        className="stats-kind-cacheRead"
        name={CACHE_READS}
        value={tokensShort(day.tokens.cacheRead)}
        muted
      />
    </span>
  );
}

interface DayRow {
  readonly id: string;
  readonly day: StatsDay;
}

function DaysTable({ days }: { readonly days: readonly StatsDay[] }): ReactNode {
  const rows: DayRow[] = days.map((day) => ({ id: day.day, day }));
  const kindColumn = (kind: (typeof KINDS)[number]) => ({
    key: kind,
    header: KIND_NAMES[kind],
    align: "right" as const,
    render: (row: DayRow) => tokensShort(row.day.tokens[kind]),
  });
  return (
    <div className="stats-table">
      <DataTable<DayRow>
        density="compact"
        stickyHeader
        columns={[
          { key: "day", header: DAY, render: (row) => dayLong(row.day.day) },
          ...KINDS.map(kindColumn),
          {
            key: "total",
            header: TOTAL,
            align: "right",
            render: (row) => <b>{tokensShort(countedTokens(row.day.tokens))}</b>,
          },
          {
            key: "cacheRead",
            header: CACHE_READS,
            align: "right",
            muted: true,
            render: (row) => tokensShort(row.day.tokens.cacheRead),
          },
        ]}
        rows={rows}
      />
    </div>
  );
}

function TopTasks({
  tasks,
  projects,
}: {
  readonly tasks: readonly StatsTopTask[];
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const first = tasks[0]?.tokens ?? 0;
  const projectOf = (task: StatsTopTask) => projects?.find(({ id }) => id === task.projectId);
  if (tasks.length === 0) return <p className="stats-empty">{TOP_TASKS_EMPTY}</p>;
  return (
    <ol className="stats-top-list">
      {tasks.map((task, index) => (
        <li key={task.taskId} className="stats-top-row">
          <div className="stats-top-line">
            <span className="stats-rank">{index + 1}</span>
            <Link to="/tasks/$taskId" params={{ taskId: task.taskId }} className="stats-task-link">
              {task.title}
            </Link>
            <ProjectChip projectId={task.projectId} projects={projects} />
            <span className="stats-top-tokens">{tokensShort(task.tokens)}</span>
          </div>
          <div className="stats-bar-track" aria-hidden="true">
            <i
              className={projectColourClass(projectOf(task))}
              style={{
                ...projectColourStyle(projectOf(task)),
                width: `${first > 0 ? (task.tokens / first) * 100 : 0}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function UsageWindowsNow({ engines }: { readonly engines: readonly StatsEngine[] }): ReactNode {
  const listed = engines.filter(({ windows }) => windows.state !== "none");
  if (listed.length === 0) return <p className="stats-empty">{NO_USAGE_WINDOWS}</p>;
  return (
    <div className="stats-engine-list">
      {listed.map(({ engineId, name, windows }) => (
        <div key={engineId} className="stats-engine">
          <div className="stats-engine-name">{name}</div>
          {windows.state === "read" ? (
            <>
              <WindowRow label={FIVE_HOUR_WINDOW} window={windows.fiveHour} />
              <WindowRow label={SEVEN_DAY_WINDOW} window={windows.sevenDay} />
            </>
          ) : (
            <span className="stats-not-read">
              <Icon name="gauge" size={13} />
              {NOT_READ_YET}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** A window's meter, amber from 90% and red used up, as on the status strip. */
function WindowRow({
  label,
  window,
}: {
  readonly label: string;
  readonly window: UsageWindow;
}): ReactNode {
  const labelId = useId();
  const tone = usageTone(window);
  const resets = windowResetWords(window.resetsAt);
  return (
    <div className="stats-window-row">
      <span id={labelId}>{label}</span>
      <span
        className="stats-meter"
        data-tone={tone}
        role="meter"
        aria-labelledby={labelId}
        aria-valuenow={Math.round(window.percentUsed)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: `${meterFilled(window)}%` }} />
      </span>
      <span className="stats-window-value">
        <b data-tone={tone}>{percentWords(window)}</b>
        {resets && ` · ${resets}`}
      </span>
    </div>
  );
}

function ThisWeek({ stats }: { readonly stats: BasicStats }): ReactNode {
  return (
    <div className="stats-week">
      <WeekFigure label={TASKS_DONE} value={stats.tasksDone} text={TASKS_DONE_TEXT} />
      <WeekFigure label={STAGE_RETRIES} value={stats.stageRetries} text={STAGE_RETRIES_TEXT} />
    </div>
  );
}

function WeekFigure({
  label,
  value,
  text,
}: {
  readonly label: string;
  readonly value: number;
  readonly text: string;
}): ReactNode {
  return (
    <div className="stats-week-figure">
      <div className="stats-week-label">{label}</div>
      <div className="stats-week-number">{value}</div>
      <p className="stats-week-text">{text}</p>
    </div>
  );
}

/** At the foot of the basic stats while there are no full stats: how to see more. */
function FullStatsMessage({ message }: { readonly message: StatsMessage }): ReactNode {
  const link = <SettingsLink />;
  return (
    <section className="stats-message stats-span-12" aria-label={FULL_STATS}>
      <span className="stats-message-icon">
        <Icon name="chart-column" size={18} />
      </span>
      <div className="stats-message-words">
        <p className="stats-message-title">{MESSAGE_WORDS[message]}</p>
        <p className="stats-message-text">{FULL_STATS_ADD}</p>
        {message === "environment" ? (
          <span className="stats-message-step">
            {ENVIRONMENT_STEP} {link}
          </span>
        ) : (
          link
        )}
      </div>
    </section>
  );
}
