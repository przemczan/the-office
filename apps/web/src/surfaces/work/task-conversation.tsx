import { useNavigate } from "@tanstack/react-router";
import { ENDED_TASK_CONVERSATION_WORDS, type Task, type Thread } from "@the-office/contracts";
import type { ReactNode } from "react";
import { EmptyCard } from "../../shell/item-card.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { PlanButton } from "./planning-actions.tsx";
import { RecordThreads } from "./record-threads.tsx";

/**
 * The Threads on the Task. Planning opens the first, with the Planner (task 11); Stages open
 * theirs as they run (task 12).
 */
export function TaskConversation({
  task,
  threads,
  shownFirst,
}: {
  readonly task: Task;
  readonly threads: readonly Thread[] | undefined;
  readonly shownFirst: string | undefined;
}): ReactNode {
  const planner = usePlanner();
  const navigate = useNavigate({ from: "/tasks/$taskId" });
  return (
    <RecordThreads
      threads={threads}
      shownFirst={shownFirst}
      onShown={(threadId) => {
        void navigate({
          search: (search) => ({ ...search, taskThread: threadId }),
          replace: true,
          resetScroll: false,
        });
      }}
      readOnlyReason={ENDED_TASK_CONVERSATION_WORDS[task.state]}
      empty={
        <EmptyCard>
          No conversation on {task.title} yet. Planning opens one with{" "}
          {planner?.card.name ?? "the Planner"}.
          <div className="task-conversation-start">
            <PlanButton task={task} />
          </div>
        </EmptyCard>
      }
    />
  );
}
