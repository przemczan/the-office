import { Skeleton } from "@the-office/ui";
import type { ReactNode } from "react";
import "./block-loader.css";

/** What the loader is shaped like: `rows` stands for a list in a card. */
export type BlockLoaderShape = "rows";

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
      {ROWS.map(([name, line, third], index) => (
        <div key={index} className="block-loader-row">
          <Skeleton width={28} height={28} radius={6} />
          <span className="block-loader-words">
            <Skeleton width={name} height={12} />
            <Skeleton width={line} height={9} />
            {third && <Skeleton width="70%" height={9} />}
          </span>
        </div>
      ))}
    </div>
  );
}
