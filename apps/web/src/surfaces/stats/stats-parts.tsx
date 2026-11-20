import { isCustomMarkColour, type Project } from "@the-office/contracts";
import { Badge, Button, Card, Icon, SegmentedControl, Select, Tooltip } from "@the-office/ui";
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { BlockLoader, type BlockLoaderShape } from "../../shell/block-loader.tsx";
import { OFFICE_WIDE, OFFICE_WIDE_WORDS, SHOW_AS_CHART, SHOW_AS_TABLE } from "./stats-words.ts";

// The parts every Stats block shares: the block, its badge and table switch, the pickers, the
// Tooltip's rows, a Project's colour and the stacked bar chart.

export function StatsBlock({
  id,
  className,
  title,
  badge,
  when,
  tools,
  loading,
  loader = "rows",
  loaderLabel,
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
  readonly loader?: BlockLoaderShape;
  readonly loaderLabel: string;
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
        {loading ? <BlockLoader shape={loader} label={loaderLabel} /> : children}
      </Card>
    </section>
  );
}

/** "Office-wide", and while a Project filter is set, why the filter doesn't narrow the block. */
export function OfficeWideBadge({ filtered }: { readonly filtered: boolean }): ReactNode {
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

/** Show as a table, or back as a chart. */
export function TableToggle({
  asTable,
  onToggle,
}: {
  readonly asTable: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <Button
      variant="ghost"
      size="sm"
      iconLeft={<Icon name={asTable ? "chart-column" : "table"} size={13} />}
      onClick={onToggle}
    >
      {asTable ? SHOW_AS_CHART : SHOW_AS_TABLE}
    </Button>
  );
}

export interface PickerOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * A few short choices: a segmented control, a select on a narrow page (stats.css), named by
 * `label`, shown before it when `shownLabel`.
 */
export function Picker<T extends string>({
  label,
  shownLabel = false,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly shownLabel?: boolean;
  readonly options: readonly PickerOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}): ReactNode {
  const choose = (picked: string): void => {
    const option = options.find((each) => each.value === picked);
    if (option) onChange(option.value);
  };
  return (
    <span className="stats-picker" role="group" aria-label={label}>
      {shownLabel && (
        <span className="stats-picker-label" aria-hidden="true">
          {label}
        </span>
      )}
      <span className="stats-picker-wide">
        <SegmentedControl size="sm" options={[...options]} value={value} onChange={choose} />
      </span>
      <span className="stats-picker-narrow">
        <Select
          size="sm"
          aria-label={label}
          options={[...options]}
          value={value}
          onChange={choose}
        />
      </span>
    </span>
  );
}

export function TipRow({
  className,
  name,
  value,
  total = false,
  muted = false,
}: {
  /** The swatch's colour class, such as `stats-kind-input`; none for a row without one. */
  readonly className?: string | undefined;
  readonly name: string;
  readonly value: string;
  readonly total?: boolean;
  readonly muted?: boolean;
}): ReactNode {
  return (
    <span
      className={`stats-tip-row${total ? " stats-tip-total" : ""}${muted ? " stats-muted" : ""}`}
    >
      <i className={className} />
      <span>{name}</span>
      <b>{value}</b>
    </span>
  );
}

/** What a chart with a Tooltip per step needs: the step picked and its handlers. */
export interface ChartPick {
  readonly picked: number | null;
  readonly setPicked: (picked: number | null) => void;
  /** The chart's one tab stop's handlers. */
  readonly stepping: {
    readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    readonly onFocus: () => void;
    readonly onBlur: () => void;
    readonly onMouseLeave: () => void;
  };
}

/**
 * A chart's one tab stop over `count` steps: focus picks the last, the arrow keys step (Shift for
 * ten), Home and End go to the first and the last; leaving it, or the mouse leaving, picks none.
 */
export function useChartPick(count: number): ChartPick {
  const [chosen, setPicked] = useState<number | null>(null);
  const last = count - 1;
  // Fewer steps after a new answer keep the pick on the chart.
  const picked = chosen === null || count === 0 ? null : Math.min(chosen, last);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (count === 0) return;
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
  return {
    picked,
    setPicked,
    stepping: {
      onKeyDown,
      onFocus: () => setPicked((at) => at ?? (count > 0 ? last : null)),
      onBlur: () => setPicked(null),
      onMouseLeave: () => setPicked(null),
    },
  };
}

/** A round step for an axis: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
}

/** A bar takes its Project's mark colour through the same `mark-colour-*` class a mark uses. */
export function projectColourClass(project: Project | undefined): string | undefined {
  if (project === undefined) return undefined;
  const { colour } = project.mark;
  return `mark-colour-${isCustomMarkColour(colour) ? "custom" : colour}`;
}

export function projectColourStyle(project: Project | undefined): CSSProperties {
  const colour = project?.mark.colour;
  return colour !== undefined && isCustomMarkColour(colour)
    ? ({ "--mark-bg": colour } as CSSProperties)
    : {};
}

/** A step of a bar chart: its key, its label under the chart ("" for none) and its Tooltip. */
export interface ChartStep {
  readonly key: string;
  readonly label: string;
  /** Hidden on a narrow chart, so the labels left don't run together. */
  readonly minor?: boolean;
  readonly tip: ReactNode;
}

/** One part of a step's stack, bottom first, coloured by its class. */
export interface ChartSegment {
  readonly className: string;
  readonly value: number;
}

/** A strip under the chart, one value per step, such as the cache reads not counted. */
export interface ChartUnder {
  readonly label: string;
  readonly values: readonly number[];
}

/**
 * Steps of stacked bars on an axis. One tab stop: the arrow keys step from bar to bar (Shift for
 * ten), Home and End go to the first and the last, each step showing its Tooltip. `under` draws a
 * strip under the chart.
 */
export function BarsChart({
  steps,
  stacks,
  axisWords,
  emptyTop,
  summary,
  under,
}: {
  readonly steps: readonly ChartStep[];
  readonly stacks: readonly (readonly ChartSegment[])[];
  readonly axisWords: (value: number) => string;
  /** What an empty chart's axis reaches, so it reads as a scale of its measure. */
  readonly emptyTop: number;
  readonly summary: string;
  readonly under?: ChartUnder;
}): ReactNode {
  const { picked, setPicked, stepping } = useChartPick(steps.length);
  const sums = stacks.map((stack) => stack.reduce((sum, { value }) => sum + value, 0));
  const most = Math.max(0, ...sums);
  const step = niceStep((most || emptyTop) / 4);
  const top = Math.max(step, Math.ceil(most / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  const mostUnder = Math.max(1, ...(under?.values ?? []));
  return (
    <div className="stats-chart" role="img" aria-label={summary} tabIndex={0} {...stepping}>
      <div className="stats-chart-main">
        <div className="stats-chart-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>
              {axisWords(tick)}
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
          {steps.map((each, index) => (
            <Tooltip key={each.key} open={picked === index} content={each.tip}>
              <span
                className="stats-chart-day"
                data-picked={picked === index || undefined}
                onMouseEnter={() => setPicked(index)}
              >
                <StackBar stack={stacks[index] ?? []} top={top} />
              </span>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="stats-chart-labels" aria-hidden="true">
        {steps.map((each) => (
          <span key={each.key} className={each.minor ? "is-minor" : undefined}>
            {each.label}
          </span>
        ))}
      </div>
      {under && (
        <div className="stats-chart-under" aria-hidden="true">
          <span className="stats-chart-under-label">{under.label}</span>
          <div className="stats-chart-under-bars">
            {steps.map((each, index) => (
              <span key={each.key} data-picked={picked === index || undefined}>
                <i style={{ height: `${((under.values[index] ?? 0) / mostUnder) * 100}%` }} />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One step's stack, its first segment at the bottom, each its share of the axis's top. */
function StackBar({
  stack,
  top,
}: {
  readonly stack: readonly ChartSegment[];
  readonly top: number;
}): ReactNode {
  const heights = stack.map(({ value }) => (value / top) * 100);
  return (
    <svg viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
      {stack.map(({ className }, index) => {
        const height = heights[index] ?? 0;
        const below = heights.slice(0, index).reduce((sum, each) => sum + each, 0);
        return height > 0 ? (
          <rect
            key={className}
            className={className}
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
