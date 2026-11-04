import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ENDED_TASK_CONVERSATION_WORDS, type Task, type Thread } from "@the-office/contracts";
import type { ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { EmptyCard } from "../../shell/item-card.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { PlanButton } from "./planning-actions.tsx";
import { ThreadTimeline } from "./thread-timeline.tsx";
import { chapterWork } from "./timeline-words.ts";

/**
 * The Threads on the Task. Planning opens the first, with the Planner (task 11); Stages open
 * theirs as they run (task 12).
 */
export function TaskConversation({
  task,
  threads,
  asked,
  onShowStage,
}: {
  readonly task: Task;
  readonly threads: readonly Thread[] | undefined;
  /** The Thread the address names. */
  readonly asked: string | undefined;
  readonly onShowStage: (stageKey: string) => void;
}): ReactNode {
  const planner = usePlanner();
  const navigate = useNavigate({ from: "/tasks/$taskId" });
  const decisions = useQuery(decisionQueries.unanswered(task.id)).data;
  const stages = useQuery(pipelineQueries.taskStages(task.id)).data?.stages;
  if (!threads) return null;
  if (threads.length === 0) {
    return (
      <aside className="task-conversation" aria-label="Conversation">
        <EmptyCard>
          No conversation on {task.title} yet. Planning opens one with{" "}
          {planner?.card.name ?? "the Planner"}.
          <div className="task-conversation-start">
            <PlanButton task={task} />
          </div>
        </EmptyCard>
      </aside>
    );
  }
  return (
    <aside className="task-conversation" aria-label="Conversation">
      <ThreadTimeline
        threads={threads}
        asked={asked}
        work={{
          holdingOpenDecision: new Set(decisions?.map(({ threadId }) => threadId)),
          waitingOnYou: new Set(
            decisions?.filter(({ putTo }) => putTo === null).map(({ threadId }) => threadId),
          ),
          workOf: (threadId) => chapterWork(stages ?? [], threadId),
          onShowStage,
        }}
        onAsked={(threadId) => {
          void navigate({
            search: ({ taskThread: _named, ...search }) => ({
              ...search,
              ...(threadId !== undefined && { taskThread: threadId }),
            }),
            replace: true,
            resetScroll: false,
          });
        }}
        readOnlyReason={ENDED_TASK_CONVERSATION_WORDS[task.state]}
      />
    </aside>
  );
}
