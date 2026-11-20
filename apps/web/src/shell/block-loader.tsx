import { Alert, Skeleton } from "@the-office/ui";
import type { ReactNode } from "react";
import "./block-loader.css";

/**
 * What the loader is shaped like: `rows` stands for a list in a card, `bars` for a bar chart,
 * `lines` for a line chart with a lane under it, `turns` for messages in a Thread, `text` for a
 * record's text under its heading and `rail` for a Pipeline rail's Stages.
 */
export type BlockLoaderShape = "rows" | "bars" | "lines" | "turns" | "text" | "rail";

export interface BlockLoaderProps {
  readonly shape: BlockLoaderShape;
  /** What it says to screen readers, such as "Loading your repositories…". */
  readonly label?: string;
  /** How many rows, turns, lines or Stages it shows, where the block holds fewer than the shape's. */
  readonly count?: number;
}

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

/** The widths of a text's lines and a turn's, in turn, so neither reads as a block. */
const LINE_WIDTHS: readonly string[] = ["92%", "74%", "86%", "62%", "80%", "68%"];

const DEFAULT_TURNS = 3;
const DEFAULT_TEXT_LINES = 4;
const DEFAULT_RAIL_STAGES = 5;

/**
 * The one loader for a block whose data hasn't arrived for the first time (docs/design/loaders.html),
 * shaped like what replaces it. It fades in after 200ms, so a quick answer shows no flash, and screen
 * readers hear its label alone.
 */
export function BlockLoader({ shape, label = "Loading…", count }: BlockLoaderProps): ReactNode {
  return (
    <div className={`block-loader ${shape}`} role="status">
      <span className="visually-hidden">{label}</span>
      {shape === "rows" && <LoaderRows count={count ?? ROWS.length} />}
      {shape === "bars" && <LoaderBars />}
      {shape === "lines" && <LoaderLines />}
      {shape === "turns" && <LoaderTurns count={count ?? DEFAULT_TURNS} />}
      {shape === "text" && <LoaderText count={count ?? DEFAULT_TEXT_LINES} />}
      {shape === "rail" && <LoaderRail count={count ?? DEFAULT_RAIL_STAGES} />}
    </div>
  );
}

/** What a block's reads didn't answer yet, or failed to. */
export interface BlockRead {
  readonly error: Error | null;
}

/**
 * A block waiting on reads, until each has first answered: the problem of the one that failed, else
 * the loader, so a failed read never leaves the block blank or loading for good.
 */
export function BlockLoaderOrProblem({
  reads,
  ...loader
}: BlockLoaderProps & { readonly reads: readonly BlockRead[] }): ReactNode {
  const failed = reads.find(({ error }) => error !== null)?.error;
  return failed ? <Alert tone="danger" title={failed.message} /> : <BlockLoader {...loader} />;
}

function LoaderRows({ count }: { readonly count: number }): ReactNode {
  return ROWS.slice(0, count).map(([name, line, third], index) => (
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

/** An avatar and two or three lines a message, as the design's `turns`. */
function LoaderTurns({ count }: { readonly count: number }): ReactNode {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className="block-loader-turn">
      <Skeleton width={28} height={28} radius={14} />
      <span className="block-loader-words">
        <Skeleton width="28%" height={10} />
        <Skeleton width={lineWidth(index)} height={10} />
        {index % 2 === 0 && <Skeleton width="55%" height={10} />}
      </span>
    </div>
  ));
}

/** A heading and its paragraph, the last line short, as the design's `lines`. */
function LoaderText({ count }: { readonly count: number }): ReactNode {
  return (
    <>
      <Skeleton width="30%" height={14} />
      <span className="block-loader-words">
        {Array.from({ length: count }, (_, index) => (
          <Skeleton
            key={index}
            width={index === count - 1 ? "58%" : lineWidth(index)}
            height={10}
          />
        ))}
      </span>
    </>
  );
}

/** The rail's overline, then each Stage's marker over its name and state. */
function LoaderRail({ count }: { readonly count: number }): ReactNode {
  return (
    <>
      <Skeleton width={160} height={10} />
      <div className="block-loader-stages">
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className="block-loader-stage">
            <Skeleton width={22} height={22} radius={11} />
            <Skeleton width={lineWidth(index + 2)} height={12} />
            <Skeleton width="45%" height={9} />
          </span>
        ))}
      </div>
    </>
  );
}

function lineWidth(index: number): string {
  return LINE_WIDTHS[index % LINE_WIDTHS.length] ?? "80%";
}
