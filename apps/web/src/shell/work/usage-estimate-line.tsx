import { useQuery } from "@tanstack/react-query";
import type { UsageEstimate } from "@the-office/contracts";
import { Icon, Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { taskQueries } from "../../api/work.ts";
import { useEngineName } from "../use-engine-name.ts";
import { usageEstimateWords } from "./usage-estimate-words.ts";
import "./usage-estimate-line.css";

/**
 * What a Task's whole Pipeline is expected to use, in the ticked measures, and where the estimate
 * came from; nothing with no measure ticked (spec §2.1, "Usage estimates"). A `compact` one stays
 * on one line, cut with an ellipsis when it has no room, its whole words in its tooltip.
 */
export function UsageEstimateLine({
  estimate,
  compact = false,
}: {
  readonly estimate: UsageEstimate | null | undefined;
  readonly compact?: boolean;
}): ReactNode {
  const engineName = useEngineName();
  if (!estimate) return null;
  const words = usageEstimateWords(estimate, engineName);
  const line = (
    <span
      className={`usage-estimate${compact ? " compact" : ""}`}
      role="note"
      aria-label="Usage estimate"
    >
      <Icon name="gauge" size={13} />
      <span>{words}</span>
    </span>
  );
  return compact ? <Tooltip content={words}>{line}</Tooltip> : line;
}

/** A Ready Task's Usage estimate from the one list the board and Now read; undefined without one. */
export function useUsageEstimate(taskId: string): UsageEstimate | undefined {
  return useQuery(taskQueries.usageEstimates()).data?.find((each) => each.taskId === taskId)
    ?.usageEstimate;
}
