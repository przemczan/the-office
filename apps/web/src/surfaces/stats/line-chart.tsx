import { Tooltip } from "@the-office/ui";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useChartPick } from "./stats-parts.tsx";

// Stats' one line chart: lines over a time axis, with one tab stop stepping each point's Tooltip.
// The Usage windows over time and every chart of System health draw with it.

/** One line: its colour class (stroke, and the dot's), its values by point, null for none. */
export interface LineSeries {
  readonly key: string;
  readonly className: string;
  readonly values: readonly (number | null)[];
  /** Shaded under the line, as a count over time is. */
  readonly area?: boolean;
}

/** A dashed line across the plot at a value, with its words at its right end when given. */
export interface LineGuide {
  readonly value: number;
  readonly className: string;
  readonly words?: string;
}

/** A label of the time axis, at an instant. */
export interface TimeTick {
  readonly at: number;
  readonly label: string;
}

/** The plot's height in the SVG's units. */
const PLOT_HEIGHT = 100;

/** The plot's width in the SVG's units. */
const PLOT_WIDTH = 1000;

/**
 * Lines over the time axis from `from` to `to`, each point at its instant in `times`, scaled to
 * `top`. A line breaks where a value is null, and where two points are more than `gapAfter`
 * apart: a time nothing was read. `hatch` hatches the time before `hatch.to`, with its words. One
 * tab stop: the arrow keys step from point to point (Shift for ten), Home and End go to the first
 * and the last, each showing its Tooltip; hovering picks the point nearest the pointer.
 */
export function LineChart({
  className,
  from,
  to,
  times,
  series,
  top,
  axis,
  grid = axis,
  axisWords,
  guides = [],
  hatch,
  timeTicks,
  gapAfter,
  summary,
  renderTip,
}: {
  /** The chart's own class beside `stats-lines`, for its height. */
  readonly className?: string;
  readonly from: number;
  readonly to: number;
  /** Each point's instant, oldest first. */
  readonly times: readonly number[];
  readonly series: readonly LineSeries[];
  readonly top: number;
  /** The values labelled on the axis. */
  readonly axis: readonly number[];
  /** The values a grid line marks, the axis's when not given. */
  readonly grid?: readonly number[];
  readonly axisWords: (value: number) => string;
  readonly guides?: readonly LineGuide[];
  readonly hatch?: { readonly to: number; readonly words: string } | undefined;
  /** Labels under the plot; none draws no time axis of its own. */
  readonly timeTicks?: readonly TimeTick[];
  /** Two points further apart than this, in ms, have a gap between them. */
  readonly gapAfter?: number;
  readonly summary: string;
  readonly renderTip: (index: number) => ReactNode;
}): ReactNode {
  const { picked, setPicked, stepping } = useChartPick(times.length);
  const span = Math.max(1, to - from);
  const x = (at: number): number => Math.max(0, Math.min(100, ((at - from) / span) * 100));
  const y = (value: number): number =>
    PLOT_HEIGHT - Math.max(0, Math.min(PLOT_HEIGHT, (value / top) * PLOT_HEIGHT));
  const pickedAt = picked === null ? undefined : times[picked];
  const hatchedTo = hatch === undefined ? 0 : x(Math.min(hatch.to, to));
  const onMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || times.length === 0) return;
    setPicked(nearest(times, from + ((event.clientX - box.left) / box.width) * span));
  };
  return (
    <div
      className={`stats-lines${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={summary}
      tabIndex={0}
      {...stepping}
    >
      <div className="stats-lines-main">
        <div className="stats-lines-axis" aria-hidden="true">
          {axis.map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>
              {axisWords(tick)}
            </span>
          ))}
        </div>
        <div className="stats-lines-plot" onMouseMove={onMouseMove}>
          {hatch !== undefined && hatchedTo > 0 && (
            <span className="stats-lines-hatch" style={{ width: `${hatchedTo}%` }}>
              <span>{hatch.words}</span>
            </span>
          )}
          <svg
            viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {grid.map((tick) => (
              <line
                key={tick}
                className="stats-lines-grid"
                x1="0"
                x2={PLOT_WIDTH}
                y1={y(tick)}
                y2={y(tick)}
              />
            ))}
            {timeTicks?.map((tick) => (
              <line
                key={tick.at}
                className="stats-lines-vgrid"
                x1={x(tick.at) * 10}
                x2={x(tick.at) * 10}
                y1="0"
                y2={PLOT_HEIGHT}
              />
            ))}
            {guides
              .filter((guide) => guide.value <= top)
              .map((guide) => (
                <line
                  key={guide.value}
                  className={guide.className}
                  x1="0"
                  x2={PLOT_WIDTH}
                  y1={y(guide.value)}
                  y2={y(guide.value)}
                />
              ))}
            {series.map((line) =>
              runsOf(times, line.values, gapAfter).map((run) => {
                const path = run
                  .map((index, at) => {
                    const time = times[index] ?? from;
                    const value = line.values[index] ?? 0;
                    return `${at === 0 ? "M" : "L"}${(x(time) * 10).toFixed(1)} ${y(value).toFixed(2)}`;
                  })
                  .join(" ");
                const first = times[run[0] ?? 0] ?? from;
                const last = times[run.at(-1) ?? 0] ?? from;
                return (
                  <g key={`${line.key}-${run[0]}`} className={line.className}>
                    {line.area && (
                      <path
                        className="stats-lines-area"
                        d={`${path} L${(x(last) * 10).toFixed(1)} ${PLOT_HEIGHT} L${(x(first) * 10).toFixed(1)} ${PLOT_HEIGHT} Z`}
                      />
                    )}
                    <path className="stats-lines-line" d={path} />
                  </g>
                );
              }),
            )}
            {pickedAt !== undefined && (
              <line
                className="stats-lines-cross"
                x1={x(pickedAt) * 10}
                x2={x(pickedAt) * 10}
                y1="0"
                y2={PLOT_HEIGHT}
              />
            )}
          </svg>
          {guides
            .filter((guide) => guide.value <= top && guide.words !== undefined)
            .map((guide) => (
              <span
                key={guide.value}
                className={`stats-lines-guide-words ${guide.className}`}
                style={{ bottom: `${(guide.value / top) * 100}%` }}
                aria-hidden="true"
              >
                {guide.words}
              </span>
            ))}
          {picked !== null && pickedAt !== undefined && (
            <>
              {series.map((line) => {
                const value = line.values[picked];
                return value === null || value === undefined ? null : (
                  <i
                    key={line.key}
                    className={`stats-lines-dot ${line.className}`}
                    style={
                      {
                        left: `${x(pickedAt)}%`,
                        bottom: `${100 - y(value)}%`,
                      } as CSSProperties
                    }
                    aria-hidden="true"
                  />
                );
              })}
              <span className="stats-lines-anchor" style={{ left: `${x(pickedAt)}%` }}>
                <Tooltip open content={renderTip(picked)}>
                  <span className="stats-lines-hit" />
                </Tooltip>
              </span>
            </>
          )}
        </div>
      </div>
      {timeTicks && (
        <div className="stats-time-ticks stats-lines-time" aria-hidden="true">
          {timeTicks.map((tick) => (
            <span key={tick.at} style={{ left: `${x(tick.at)}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The index of the instant nearest `at`, `times` oldest first. */
function nearest(times: readonly number[], at: number): number {
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((times[middle] ?? 0) < at) low = middle + 1;
    else high = middle;
  }
  const before = times[low - 1];
  return before !== undefined && Math.abs(before - at) < Math.abs((times[low] ?? 0) - at)
    ? low - 1
    : low;
}

/** The runs of points a line joins: broken by a null value and by a gap in time. */
function runsOf(
  times: readonly number[],
  values: readonly (number | null)[],
  gapAfter: number | undefined,
): readonly (readonly number[])[] {
  const runs: number[][] = [];
  let run: number[] = [];
  values.forEach((value, index) => {
    const before = run.at(-1);
    const apart =
      gapAfter !== undefined &&
      before !== undefined &&
      (times[index] ?? 0) - (times[before] ?? 0) > gapAfter;
    if (value === null || apart) {
      if (run.length > 0) runs.push(run);
      run = value === null ? [] : [index];
      return;
    }
    run.push(index);
  });
  if (run.length > 0) runs.push(run);
  return runs;
}
