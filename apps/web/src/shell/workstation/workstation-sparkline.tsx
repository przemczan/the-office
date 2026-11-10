import type { ReactNode } from "react";
import { HISTORY_LENGTH } from "./workstation-history.ts";

const WIDTH = 100;
const HEIGHT = 32;

/**
 * The recent uses in % as an area chart, the newest at the right edge, so a short history grows
 * in from the right as a full one scrolls. Drawn in the level colour its tile sets; nothing until
 * there are two uses to join.
 */
export function WorkstationSparkline({
  percents,
}: {
  readonly percents: readonly number[];
}): ReactNode {
  if (percents.length < 2) return null;
  const step = WIDTH / (HISTORY_LENGTH - 1);
  const start = WIDTH - step * (percents.length - 1);
  const points = percents.map((percent, index) => {
    const clamped = Math.min(100, Math.max(0, percent));
    return `${(start + step * index).toFixed(2)},${(HEIGHT - (clamped / 100) * HEIGHT).toFixed(2)}`;
  });
  const line = points.join(" ");
  return (
    <svg
      className="shell-workstation-sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={`${start.toFixed(2)},${HEIGHT} ${line} ${WIDTH},${HEIGHT}`} />
      <polyline points={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
