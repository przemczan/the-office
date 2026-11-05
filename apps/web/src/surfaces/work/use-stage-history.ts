import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { TaskStage } from "@the-office/contracts";
import { useState } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";

/** The Stage whose history window is open, and the run the address named, which it opens at. */
export interface ShownStage {
  readonly stageKey: string;
  readonly askedRunId?: string;
}

export interface StageHistoryShowing {
  readonly shown: ShownStage | undefined;
  /** The Thread the address names; what names a Stage run is the window's, not the conversation's. */
  readonly askedThread: string | undefined;
  readonly show: (stageKey: string) => void;
  readonly close: () => void;
}

/**
 * Which Stage's history is open: a look, held here and not in the address, unless a link named a
 * run (`taskThread`). Closing takes that run off the address, so the same link works again.
 */
export function useStageHistory(
  taskId: string,
  taskThread: string | undefined,
): StageHistoryShowing {
  const navigate = useNavigate({ from: "/tasks/$taskId" });
  const stages = useQuery(pipelineQueries.taskStages(taskId)).data?.stages;
  const [shown, setShown] = useState<ShownStage>();
  const [followedRunId, setFollowedRunId] = useState<string>();
  const asked = stageOfRun(stages ?? [], taskThread);
  if (asked?.askedRunId !== followedRunId) {
    setFollowedRunId(asked?.askedRunId);
    if (asked) setShown(asked);
  }
  return {
    shown,
    // Until the Stages are read, a run's id could be taken for a Thread's.
    askedThread: stages === undefined || asked ? undefined : taskThread,
    show: (stageKey) => setShown({ stageKey }),
    close: () => {
      setShown(undefined);
      if (!asked) return;
      void navigate({
        search: ({ taskThread: _run, ...search }) => search,
        replace: true,
        resetScroll: false,
      });
    },
  };
}

function stageOfRun(
  stages: readonly TaskStage[],
  runId: string | undefined,
): ShownStage | undefined {
  const taskStage = stages.find(({ runs }) => runs.some(({ id }) => id === runId));
  return taskStage && runId !== undefined
    ? { stageKey: taskStage.stage.key, askedRunId: runId }
    : undefined;
}
