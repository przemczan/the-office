import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ENDED_TASK_CONVERSATION_WORDS, type Task, type Thread } from "@the-office/contracts";
import type { ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { EmptyCard } from "../../shell/item-card.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { useConversationDrawer, useDrawerFollowsAddress } from "./conversation-drawer.tsx";
import { MakeAPlanButton } from "./planning-actions.tsx";
import { ThreadTimeline } from "./thread-timeline.tsx";
import { chapterWork } from "./timeline-words.ts";

/** Held, waiting to start or ended, nothing in the Task is live. */
const WORK_GOES_ON: readonly Task["state"][] = ["planning", "in-progress", "waiting-on-you"];

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
  const { decision: decisionId } = useSearch({ from: "/tasks/$taskId" });
  const drawer = useConversationDrawer();
  useDrawerFollowsAddress(
    decisions && threads && threads.length > 0
      ? {
          threadId: asked,
          decisionId,
          decisionIsOpen: decisions.some(({ id }) => id === decisionId),
        }
      : undefined,
  );
  if (!threads) return null;
  const readOnlyReason = ENDED_TASK_CONVERSATION_WORDS[task.state];
  if (threads.length === 0) {
    return (
      <aside className="task-conversation" aria-label="Conversation">
        <EmptyCard>
          {readOnlyReason !== undefined ? (
            `No conversation on ${task.title}.`
          ) : task.state !== "backlog" ? (
            "No Planning Thread on this Task."
          ) : planner ? (
            <>
              {planner.card.name} plans from the title
              {task.description !== "" && " and the Description"}, so there is nothing more to
              write.
              <div className="task-conversation-start">
                <MakeAPlanButton task={task} />
              </div>
              <p className="task-quiet">
                Or Plan with {planner.card.name} in the head, to talk it through first.
              </p>
            </>
          ) : (
            `No conversation on ${task.title} yet. Planning opens one with the Planner.`
          )}
        </EmptyCard>
      </aside>
    );
  }
  return (
    <ThreadTimeline
      record="Task"
      threads={threads}
      asked={asked}
      work={{
        holdingOpenDecision: new Set(decisions?.map(({ threadId }) => threadId)),
        waitingOnYou: new Set(
          decisions?.filter(({ putTo }) => putTo === null).map(({ threadId }) => threadId),
        ),
        workGoesOn: WORK_GOES_ON.includes(task.state),
        planConfirmed: task.planConfirmed,
        workOf: (threadId) => chapterWork(stages ?? [], threadId),
        onShowStage: (stageKey) => {
          drawer.close();
          onShowStage(stageKey);
        },
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
      readOnlyReason={readOnlyReason}
    />
  );
}
