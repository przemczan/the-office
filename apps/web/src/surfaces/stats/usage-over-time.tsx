import { FULL_STATS_SPLITS, type FullStatsRead, type FullStatsSplit } from "@the-office/contracts";
import { DataTable } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import {
  BarsChart,
  Picker,
  StatsBlock,
  TableToggle,
  TipRow,
  type ChartStep,
} from "./stats-parts.tsx";
import {
  EMPTY_GROUP_WORDS,
  ESTIMATED,
  ESTIMATED_COST,
  DAY,
  DAY_MS,
  LOADING_FULL,
  MEASURE,
  MEASURE_LABELS,
  noEngineCallWords,
  NOTHING_RAN,
  OTHER,
  RANGE_WORDS,
  SPLIT_BY,
  SPLIT_LABELS,
  stepLabel,
  stepLong,
  TOKENS,
  TOTAL,
  USAGE_OVER_TIME,
  WHEN,
  usdAxisWords,
  usdWords,
  type Measure,
} from "./stats-words.ts";

/** Tokens in short, whole: "4.2M". */
function tokenWords(value: number): string {
  return tokensShort(Math.round(value));
}

/** How many of the split's values the chart names; the rest stack as Other. */
const NAMED = 5;

/** What an empty chart's axis reaches: 100k tokens, or $1. */
const EMPTY_TOP: Readonly<Record<Measure, number>> = { tokens: 100_000, cost: 1 };

/** One value of the split, or Other: its name, its colour class and its amount per step. */
interface Series {
  readonly name: string;
  readonly className: string;
  readonly values: number[];
  total: number;
}

/** The split's values over the steps, the five largest named and the rest as Other. */
function seriesOf(stats: FullStatsRead, measure: Measure): readonly Series[] {
  const amountOf = (group: { tokens: number; estimatedCostUsd: number }): number =>
    measure === "cost" ? group.estimatedCostUsd : group.tokens;
  const totals = new Map<string, number>();
  for (const { groups } of stats.usage) {
    for (const group of groups) {
      totals.set(group.name, (totals.get(group.name) ?? 0) + amountOf(group));
    }
  }
  const names = [...totals.keys()]
    .filter((name) => (totals.get(name) ?? 0) > 0)
    .toSorted((first, second) => (totals.get(second) ?? 0) - (totals.get(first) ?? 0));
  const named = names.length > NAMED + 1 ? names.slice(0, NAMED) : names;
  const series: Series[] = named.map((name, index) => ({
    name: name === "" ? EMPTY_GROUP_WORDS[stats.split] : name,
    className: `stats-series-${index + 1}`,
    values: stats.usage.map(() => 0),
    total: 0,
  }));
  const other: Series | undefined =
    names.length > named.length
      ? {
          name: OTHER,
          className: "stats-series-other",
          values: stats.usage.map(() => 0),
          total: 0,
        }
      : undefined;
  stats.usage.forEach(({ groups }, step) => {
    for (const group of groups) {
      const index = named.indexOf(group.name);
      const into = index === -1 ? other : series[index];
      if (into === undefined) continue;
      const amount = amountOf(group);
      into.values[step] = (into.values[step] ?? 0) + amount;
      into.total += amount;
    }
  });
  return other ? [...series, other] : series;
}

function spendOf(stats: FullStatsRead, step: number): { tokens: number; cost: number } {
  const groups = stats.usage[step]?.groups ?? [];
  return {
    tokens: groups.reduce((sum, { tokens }) => sum + tokens, 0),
    cost: groups.reduce((sum, { estimatedCostUsd }) => sum + estimatedCostUsd, 0),
  };
}

/** How long each step is, from the first two; a day while there is one step or none. */
function stepMsOf(stats: FullStatsRead): number {
  const [first, second] = stats.usage;
  return first && second ? Date.parse(second.at) - Date.parse(first.at) : DAY_MS;
}

/**
 * The steps' labels: by the clock every third step of 24 h; else the start of each day, or every
 * fifth of whole-day steps, counted back from the last, so they don't crowd.
 */
function stepsOf(stats: FullStatsRead): readonly Omit<ChartStep, "tip">[] {
  const stepMs = stepMsOf(stats);
  const last = stats.usage.length - 1;
  if (stats.range === "24h" || stepMs >= DAY_MS) {
    const every = stats.range === "24h" ? 3 : stats.range === "7d" ? 1 : 5;
    return stats.usage.map(({ at }, index) => {
      const fromLast = last - index;
      const labelled = fromLast % every === 0;
      return {
        key: at,
        label: labelled ? stepLabel(at, stepMs, stats.range === "24h") : "",
        minor: labelled && fromLast % (2 * every) !== 0,
      };
    });
  }
  let days = 0;
  return stats.usage.map(({ at }, index) => {
    const previous = stats.usage[index - 1];
    const startsADay =
      previous !== undefined && new Date(previous.at).getDate() !== new Date(at).getDate();
    if (startsADay) days += 1;
    return {
      key: at,
      label: startsADay ? stepLabel(at, stepMs, false) : "",
      minor: startsADay && days % 2 === 0,
    };
  });
}

/**
 * Tokens and estimated cost over time (spec 2.11, Full stats 3): a Tokens or Estimated cost switch,
 * the split, the five largest values and Other stacked per step, a legend with each one's total,
 * and Show as a table.
 */
export function UsageOverTime({
  stats,
  loading,
  split,
  onSplit,
}: {
  readonly stats: FullStatsRead | undefined;
  readonly loading: boolean;
  readonly split: FullStatsSplit;
  readonly onSplit: (split: FullStatsSplit) => void;
}): ReactNode {
  const [measure, setMeasure] = useState<Measure>("tokens");
  const [asTable, setAsTable] = useState(false);
  const shown = loading ? undefined : stats;
  const tools = (
    <>
      <Picker
        label={MEASURE}
        options={(["tokens", "cost"] as const).map((value) => ({
          value,
          label: MEASURE_LABELS[value],
        }))}
        value={measure}
        onChange={setMeasure}
      />
      <Picker
        label={SPLIT_BY}
        shownLabel
        options={FULL_STATS_SPLITS.map((value) => ({ value, label: SPLIT_LABELS[value] }))}
        value={split}
        onChange={onSplit}
      />
      {shown && <TableToggle asTable={asTable} onToggle={() => setAsTable(!asTable)} />}
    </>
  );
  return (
    <StatsBlock
      id="usage"
      className="stats-span-12"
      title={USAGE_OVER_TIME}
      tools={tools}
      loading={shown === undefined}
      loader="bars"
      loaderLabel={LOADING_FULL}
    >
      {shown && <UsageBody stats={shown} measure={measure} asTable={asTable} />}
    </StatsBlock>
  );
}

function UsageBody({
  stats,
  measure,
  asTable,
}: {
  readonly stats: FullStatsRead;
  readonly measure: Measure;
  readonly asTable: boolean;
}): ReactNode {
  const series = seriesOf(stats, measure);
  const words = measure === "cost" ? usdWords : tokenWords;
  const spends = stats.usage.map((_, step) => spendOf(stats, step));
  const tokens = spends.reduce((sum, spend) => sum + spend.tokens, 0);
  const cost = spends.reduce((sum, spend) => sum + spend.cost, 0);
  const head = (
    <p className="stats-figure">
      <span>
        <b>{tokensShort(Math.round(tokens))}</b> {TOKENS.toLowerCase()}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        <b>{usdWords(cost)}</b> {ESTIMATED}
      </span>
      <span aria-hidden="true">·</span>
      <span>{RANGE_WORDS[stats.range]}</span>
    </p>
  );
  if (series.length === 0) {
    return (
      <>
        {head}
        <p className="stats-empty">{noEngineCallWords(stats.range)}</p>
      </>
    );
  }
  return (
    <>
      {head}
      <ul className="stats-legend">
        {series.map(({ name, className, total }) => (
          <li key={className}>
            <i className={className} />
            {name} <b>{words(total)}</b>
          </li>
        ))}
      </ul>
      {asTable ? (
        <UsageTable stats={stats} series={series} measure={measure} words={words} />
      ) : (
        <UsageChart stats={stats} series={series} measure={measure} words={words} />
      )}
    </>
  );
}

function UsageChart({
  stats,
  series,
  measure,
  words,
}: {
  readonly stats: FullStatsRead;
  readonly series: readonly Series[];
  readonly measure: Measure;
  readonly words: (value: number) => string;
}): ReactNode {
  const total = series.reduce((sum, each) => sum + each.total, 0);
  const top = series.reduce<Series | undefined>(
    (best, each) => (best === undefined || each.total > best.total ? each : best),
    undefined,
  );
  const summary = `${MEASURE_LABELS[measure]} over the last ${RANGE_WORDS[stats.range]}, split by ${SPLIT_LABELS[
    stats.split
  ].toLowerCase()}: ${words(total)} in all${
    top ? `, the most from ${top.name} with ${words(top.total)}` : ""
  }. Use the arrow keys to read each step.`;
  return (
    <BarsChart
      steps={stepsOf(stats).map((each, step) => ({
        ...each,
        tip: <UsageTip stats={stats} series={series} step={step} measure={measure} />,
      }))}
      stacks={stats.usage.map((_, step) =>
        series.map(({ className, values }) => ({ className, value: values[step] ?? 0 })),
      )}
      axisWords={measure === "cost" ? usdAxisWords : tokensShort}
      emptyTop={EMPTY_TOP[measure]}
      summary={summary}
    />
  );
}

function UsageTip({
  stats,
  series,
  step,
  measure,
}: {
  readonly stats: FullStatsRead;
  readonly series: readonly Series[];
  readonly step: number;
  readonly measure: Measure;
}): ReactNode {
  const at = stats.usage[step]?.at ?? stats.from;
  const spend = spendOf(stats, step);
  const ran = series.filter(({ values }) => (values[step] ?? 0) > 0);
  const words = measure === "cost" ? usdWords : tokenWords;
  return (
    <span className="stats-tip">
      <span className="stats-tip-title">
        {stepLong(at, stepMsOf(stats))}
        {measure === "cost" && ` · ${ESTIMATED}`}
      </span>
      {ran.length === 0 && <span className="stats-muted">{NOTHING_RAN}</span>}
      {ran.map(({ name, className, values }) => (
        <TipRow
          key={className}
          className={className}
          name={name}
          value={words(values[step] ?? 0)}
        />
      ))}
      {measure === "cost" ? (
        <>
          <TipRow name={ESTIMATED_COST} value={usdWords(spend.cost)} total />
          <TipRow name={TOKENS} value={tokenWords(spend.tokens)} muted />
        </>
      ) : (
        <>
          <TipRow name={TOTAL} value={tokenWords(spend.tokens)} total />
          <TipRow name={ESTIMATED_COST} value={usdWords(spend.cost)} muted />
        </>
      )}
    </span>
  );
}

interface StepRow {
  readonly id: string;
  readonly step: number;
}

function UsageTable({
  stats,
  series,
  measure,
  words,
}: {
  readonly stats: FullStatsRead;
  readonly series: readonly Series[];
  readonly measure: Measure;
  readonly words: (value: number) => string;
}): ReactNode {
  const rows: StepRow[] = stats.usage.map(({ at }, step) => ({ id: at, step }));
  return (
    <div className="stats-table">
      <DataTable<StepRow>
        density="compact"
        stickyHeader
        columns={[
          {
            key: "step",
            header: stepMsOf(stats) >= DAY_MS ? DAY : WHEN,
            render: (row) => stepLong(stats.usage[row.step]?.at ?? stats.from, stepMsOf(stats)),
          },
          ...series.map(({ name, className, values }) => ({
            key: className,
            header: name,
            align: "right" as const,
            render: (row: StepRow) => words(values[row.step] ?? 0),
          })),
          {
            key: "total",
            header: measure === "cost" ? ESTIMATED_COST : TOTAL,
            align: "right",
            render: (row) => {
              const spend = spendOf(stats, row.step);
              return <b>{measure === "cost" ? usdWords(spend.cost) : words(spend.tokens)}</b>;
            },
          },
        ]}
        rows={rows}
      />
    </div>
  );
}
