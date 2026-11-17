import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BASIC_STATS_DAYS,
  countedTokens,
  isCustomMarkColour,
  type BasicStats,
  type Project,
  type StatsDay,
  type StatsEngine,
  type StatsTopTask,
} from "@the-office/contracts";
import { Alert, Badge, Button, Card, DataTable, Icon, Tooltip } from "@the-office/ui";
import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { statsQueries, telemetryQueries } from "../../api/telemetry.ts";
import { BlockLoader } from "../../shell/block-loader.tsx";
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
  OFFICE_WIDE,
  OFFICE_WIDE_WORDS,
  SETTINGS_TELEMETRY,
  SEVEN_DAY_WINDOW,
  SHOW_AS_CHART,
  SHOW_AS_TABLE,
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
 * Stats (spec 2.11): the basic stats, from what The Office already keeps, read when the page opens
 * and every minute while it is open. Tokens per day and the Usage windows are Office-wide; the top
 * Tasks and This week follow the Project filter. The message at the foot says how to see more.
 */
export function StatsPage(): ReactNode {
  const { filter } = useProjectFilter();
  const stats = useQuery(statsQueries.basic(filter));
  const telemetry = useQuery(telemetryQueries.settings());
  const projects = useQuery(projectQueries.list());
  const filtered = filter !== "all";
  const message = telemetry.data ? statsMessageOf(telemetry.data) : null;
  return (
    <div className="stats-page">
      <div className="stats-page-head">
        <h2 className="stats-page-title">{STATS_TITLE}</h2>
        <p className="stats-page-sub">{STATS_SUB}</p>
      </div>
      {stats.error && <Alert tone="danger" title={stats.error.message} />}
      <div className="stats-blocks">
        <StatsBlock
          id="days"
          className="stats-span-8"
          title={TOKENS_PER_DAY}
          badge={<OfficeWideBadge filtered={filtered} />}
          loading={!stats.data && !stats.error}
        >
          {stats.data && <TokensPerDay days={stats.data.days} />}
        </StatsBlock>
        <StatsBlock
          id="windows-now"
          className="stats-span-4"
          title={USAGE_WINDOWS_NOW}
          badge={<OfficeWideBadge filtered={filtered} />}
          loading={!stats.data && !stats.error}
        >
          {stats.data && <UsageWindowsNow engines={stats.data.engines} />}
        </StatsBlock>
        <StatsBlock
          id="top"
          className="stats-span-8"
          title={TOP_TASKS}
          when={stats.data && sinceWords(stats.data.weekStartsAt)}
          loading={!stats.data && !stats.error}
          foot={
            <span className="stats-hint">
              <Icon name="info" size={12} />
              {TOP_TASKS_HINT}
            </span>
          }
        >
          {stats.data && <TopTasks tasks={stats.data.topTasks} projects={projects.data} />}
        </StatsBlock>
        <StatsBlock
          id="week"
          className="stats-span-4"
          title={THIS_WEEK}
          when={stats.data && sinceWords(stats.data.weekStartsAt)}
          loading={!stats.data && !stats.error}
        >
          {stats.data && <ThisWeek stats={stats.data} />}
        </StatsBlock>
        {message && <FullStatsMessage message={message} />}
      </div>
    </div>
  );
}

function StatsBlock({
  id,
  className,
  title,
  badge,
  when,
  tools,
  loading,
  foot,
  children,
}: {
  readonly id: string;
  readonly className: string;
  readonly title: string;
  readonly badge?: ReactNode;
  readonly when?: string | undefined;
  readonly tools?: ReactNode;
  readonly loading: boolean;
  readonly foot?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const titleId = `stats-${id}-title`;
  return (
    <section className={`stats-block ${className}`} aria-labelledby={titleId}>
      <Card footer={foot}>
        <header className="stats-block-head">
          <div className="stats-block-heading">
            <h3 className="stats-block-title" id={titleId}>
              {title}
            </h3>
            {badge}
            {when && <span className="stats-block-when">{when}</span>}
          </div>
          {tools && <div className="stats-block-tools">{tools}</div>}
        </header>
        {loading ? <BlockLoader shape="rows" label={LOADING} /> : children}
      </Card>
    </section>
  );
}

/** "Office-wide", and while a Project filter is set, why the filter doesn't narrow the block. */
function OfficeWideBadge({ filtered }: { readonly filtered: boolean }): ReactNode {
  if (!filtered) return <Badge>{OFFICE_WIDE}</Badge>;
  return (
    <Tooltip content={OFFICE_WIDE_WORDS} focusable>
      <Badge>
        <span className="stats-office-wide">
          {OFFICE_WIDE}
          <span className="visually-hidden">: {OFFICE_WIDE_WORDS}</span>
          <Icon name="info" size={11} />
        </span>
      </Badge>
    </Tooltip>
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
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Icon name={asTable ? "chart-column" : "table"} size={13} />}
          onClick={() => setAsTable(!asTable)}
        >
          {asTable ? SHOW_AS_CHART : SHOW_AS_TABLE}
        </Button>
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

/** A round step for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
}

/** The tokens an empty chart's axis is drawn as reaching, so it reads as a scale of tokens. */
const EMPTY_AXIS_TOKENS = 100_000;

/** Of the 30 days, every how many has a label under the chart, so the labels don't crowd. */
const LABEL_EVERY = 5;

/**
 * The 30 days stacked by kind, the cache reads in their own strip under them. One tab stop: the
 * arrow keys step from day to day, Home and End go to the first and today, each day's Tooltip
 * giving all four kinds and its total.
 */
function DaysChart({ days }: { readonly days: readonly StatsDay[] }): ReactNode {
  const [picked, setPicked] = useState<number | null>(null);
  const counted = days.map(({ tokens }) => countedTokens(tokens));
  const most = Math.max(0, ...counted);
  const step = niceStep((most || EMPTY_AXIS_TOKENS) / 4);
  const top = Math.max(step, Math.ceil(most / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  const mostReads = Math.max(1, ...days.map(({ tokens }) => tokens.cacheRead));
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
  return (
    <div
      className="stats-chart"
      role="img"
      aria-label={summary}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setPicked((at) => at ?? last)}
      onBlur={() => setPicked(null)}
      onMouseLeave={() => setPicked(null)}
    >
      <div className="stats-chart-main">
        <div className="stats-chart-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>
              {tokensShort(tick)}
            </span>
          ))}
        </div>
        <div className="stats-chart-plot">
          {ticks.map((tick) => (
            <i
              key={tick}
              className={`stats-chart-grid${tick === 0 ? " stats-chart-base" : ""}`}
              style={{ bottom: `${(tick / top) * 100}%` }}
              aria-hidden="true"
            />
          ))}
          {days.map((day, index) => (
            <Tooltip
              key={day.day}
              open={picked === index}
              content={<DayTip day={day} today={index === last} />}
            >
              <span
                className="stats-chart-day"
                data-picked={picked === index || undefined}
                onMouseEnter={() => setPicked(index)}
              >
                <DayBar day={day} top={top} />
              </span>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="stats-chart-labels" aria-hidden="true">
        {days.map((day, index) => {
          const fromToday = last - index;
          const labelled = fromToday % LABEL_EVERY === 0;
          // Every other label gives way on a narrow chart, so the ones left don't run together.
          const minor = labelled && fromToday % (2 * LABEL_EVERY) !== 0;
          return (
            <span key={day.day} className={minor ? "is-minor" : undefined}>
              {labelled ? dayLabel(day.day) : ""}
            </span>
          );
        })}
      </div>
      <div className="stats-chart-under" aria-hidden="true">
        <span className="stats-chart-under-label">
          {CACHE_READS} · {tokensShort(reads)} in {days.length} days
        </span>
        <div className="stats-chart-under-bars">
          {days.map((day, index) => (
            <span key={day.day} data-picked={picked === index || undefined}>
              <i style={{ height: `${(day.tokens.cacheRead / mostReads) * 100}%` }} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One day's stack, input at the bottom, each kind's share of the axis's top. */
function DayBar({ day, top }: { readonly day: StatsDay; readonly top: number }): ReactNode {
  const heights = KINDS.map((kind) => (day.tokens[kind] / top) * 100);
  return (
    <svg viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
      {KINDS.map((kind, index) => {
        const height = heights[index] ?? 0;
        const below = heights.slice(0, index).reduce((sum, each) => sum + each, 0);
        return height > 0 ? (
          <rect
            key={kind}
            className={`stats-kind-${kind}`}
            x="0"
            y={100 - below - height}
            width="10"
            height={height}
          />
        ) : null;
      })}
    </svg>
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
          kind={kind}
          name={KIND_NAMES[kind]}
          value={tokensShort(day.tokens[kind])}
        />
      ))}
      <TipRow name={TOTAL} value={tokensShort(countedTokens(day.tokens))} total />
      <TipRow kind="cacheRead" name={CACHE_READS} value={tokensShort(day.tokens.cacheRead)} muted />
    </span>
  );
}

function TipRow({
  kind,
  name,
  value,
  total = false,
  muted = false,
}: {
  readonly kind?: string;
  readonly name: string;
  readonly value: string;
  readonly total?: boolean;
  readonly muted?: boolean;
}): ReactNode {
  return (
    <span
      className={`stats-tip-row${total ? " stats-tip-total" : ""}${muted ? " stats-muted" : ""}`}
    >
      {kind ? <i className={`stats-kind-${kind}`} /> : <i />}
      <span>{name}</span>
      <b>{value}</b>
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
              className={projectBarClass(projectOf(task))}
              style={{
                ...projectBarStyle(projectOf(task)),
                width: `${first > 0 ? (task.tokens / first) * 100 : 0}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The bar takes its Project's mark colour through the same `mark-colour-*` class a mark uses. */
function projectBarClass(project: Project | undefined): string | undefined {
  if (project === undefined) return undefined;
  const { colour } = project.mark;
  return `mark-colour-${isCustomMarkColour(colour) ? "custom" : colour}`;
}

function projectBarStyle(project: Project | undefined): CSSProperties {
  const colour = project?.mark.colour;
  return colour !== undefined && isCustomMarkColour(colour)
    ? ({ "--mark-bg": colour } as CSSProperties)
    : {};
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
  const link = (
    <Link to="/settings/telemetry" className="stats-settings-link">
      {SETTINGS_TELEMETRY}
      <Icon name="arrow-right" size={13} />
    </Link>
  );
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
