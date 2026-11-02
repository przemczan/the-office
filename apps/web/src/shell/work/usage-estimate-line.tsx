import { useQuery } from "@tanstack/react-query";
import type { UsageEstimate } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { taskQueries } from "../../api/work.ts";
import { useEngineName } from "../use-engine-name.ts";
import { usageEstimateWords } from "./usage-estimate-words.ts";
import "./usage-estimate-line.css";

/**
 * What a Task's whole Pipeline is expected to use, in the ticked measures, and where the estimate
 * came from; nothing with no measure ticked (spec §2.1, "Usage estimates").
 */
export function UsageEstimateLine({
  estimate,
}: {
  readonly estimate: UsageEstimate | null | undefined;
}): ReactNode {
  const engineName = useEngineName();
  if (!estimate) return null;
  return (
    <span className="usage-estimate" role="note" aria-label="Usage estimate">
      <Icon name="gauge" size={13} />
      <span>{usageEstimateWords(estimate, engineName)}</span>
    </span>
  );
}

/** A Ready Task's Usage estimate from the one list the board and Now read; undefined without one. */
export function useUsageEstimate(taskId: string): UsageEstimate | undefined {
  return useQuery(taskQueries.usageEstimates()).data?.find((each) => each.taskId === taskId)
    ?.usageEstimate;
}
