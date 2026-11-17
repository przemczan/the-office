import { Skeleton } from "@the-office/ui";
import type { ReactNode } from "react";
import "./block-loader.css";

/**
 * What the loader is shaped like: `rows` stands for a list in a card, `bars` for a bar chart and
 * `lines` for a line chart with a lane under it.
 */
export type BlockLoaderShape = "rows" | "bars" | "lines";

/** Each placeholder row's name and line widths, and whether it has a third line, so rows vary. */
const ROWS: readonly (readonly [string, string, boolean])[] = [
  ["38%", "52%", true],
  ["24%", "40%", true],
  ["46%", "34%", false],
  ["30%", "48%", true],
  ["52%", "30%", false],
  ["28%", "44%", true],
  ["40%", "36%", false],
];

/** The bars' heights, so the chart's shape varies. */
const BARS: readonly number[] = Array.from({ length: 16 }, (_, index) => 28 + ((index * 41) % 60));

/** The lane's rows, each a bar's width and where it starts. */
const LANE: readonly (readonly [string, string])[] = [
  ["40%", "8%"],
  ["57%", "31%"],
  ["74%", "14%"],
  ["40%", "37%"],
  ["57%", "20%"],
];

/**
 * The one loader for a block whose data hasn't arrived for the first time (docs/design/loaders.html),
 * shaped like what replaces it. It fades in after 200ms, so a quick answer shows no flash, and screen
 * readers hear its label alone.
 */
export function BlockLoader({
  shape,
  label = "Loading…",
}: {
  readonly shape: BlockLoaderShape;
  /** What it says to screen readers, such as "Loading your repositories…". */
  readonly label?: string;
}): ReactNode {
  return (
    <div className={`block-loader ${shape}`} role="status">
      <span className="visually-hidden">{label}</span>
      {shape === "rows" && <LoaderRows />}
      {shape === "bars" && <LoaderBars />}
      {shape === "lines" && <LoaderLines />}
    </div>
  );
}

function LoaderRows(): ReactNode {
  return ROWS.map(([name, line, third], index) => (
    <div key={index} className="block-loader-row">
      <Skeleton width={28} height={28} radius={6} />
      <span className="block-loader-words">
        <Skeleton width={name} height={12} />
        <Skeleton width={line} height={9} />
        {third && <Skeleton width="70%" height={9} />}
      </span>
    </div>
  ));
}

function LoaderBars(): ReactNode {
  return (
    <>
      <div className="block-loader-head">
        <Skeleton width={150} height={14} />
        <Skeleton width={90} height={14} />
      </div>
      <div className="block-loader-bars">
        {BARS.map((height, index) => (
          <Skeleton key={index} width="100%" height={`${height}%`} />
        ))}
      </div>
    </>
  );
}

function LoaderLines(): ReactNode {
  return (
    <>
      <Skeleton width="100%" height={170} radius={6} />
      <div className="block-loader-lane">
        {LANE.map(([width, start], index) => (
          <Skeleton key={index} width={width} height={10} style={{ marginLeft: start }} />
        ))}
      </div>
    </>
  );
}
