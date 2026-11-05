import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { TaskStage } from "@the-office/contracts";
import { useState } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { chapterWork } from "./timeline-words.ts";

/** The Stage whose history window is open, and the run the address named, which it opens at. */
export interface ShownStage {
  readonly stageKey: string;
  readonly askedRunId?: string;
}

export interface StageHistoryShowing {
  readonly shown: ShownStage | undefined;
  /** What the address names for the conversation; a Stage run is the window's. */
  readonly askedThread: string | undefined;
  readonly show: (stageKey: string) => void;
  readonly close: () => void;
  /** Closes it for a link that sets the address itself. */
  readonly hide: () => void;
}

/**
 * Which Stage's history is open: a look, held here and not in the address, unless a link named a
 * run (`taskThread`), or a Stage's Thread, read at its latest run. Closing takes that off the address,
 * so the same link works again, and a link leading elsewhere closes the window.
 */
export function useStageHistory(
  taskId: string,
  taskThread: string | undefined,
  decisionId: string | undefined,
): StageHistoryShowing {
  const navigate = useNavigate({ from: "/tasks/$taskId" });
  const stages = useQuery(pipelineQueries.taskStages(taskId)).data?.stages;
  const [shown, setShown] = useState<ShownStage>();
  const [followed, setFollowed] = useState<string>();
  const asked = stageAsked(stages ?? [], taskThread, decisionId);
  if (stages !== undefined && taskThread !== followed) {
    setFollowed(taskThread);
    if (taskThread !== undefined) setShown(asked);
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
    hide: () => setShown(undefined),
  };
}

/** Beside a Decision the link lands on its card, which a window would cover. */
function stageAsked(
  stages: readonly TaskStage[],
  taskThread: string | undefined,
  decisionId: string | undefined,
): ShownStage | undefined {
  if (taskThread === undefined) return undefined;
  const isRun = stages.some(({ runs }) => runs.some(({ id }) => id === taskThread));
  const runId = isRun
    ? taskThread
    : decisionId === undefined
      ? chapterWork(stages, taskThread).runId
      : undefined;
  const taskStage = stages.find(({ runs }) => runs.some(({ id }) => id === runId));
  return taskStage && runId !== undefined
    ? { stageKey: taskStage.stage.key, askedRunId: runId }
    : undefined;
}
