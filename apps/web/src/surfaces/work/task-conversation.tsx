import { useQuery } from "@tanstack/react-query";
import type { Role, Task, Thread } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { threadTitle } from "../../shell/conversation/thread-title.ts";
import { ThreadView } from "../../shell/conversation/thread-view.tsx";
import { EmptyCard } from "../../shell/item-card.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { PlanButton } from "./planning-actions.tsx";

/**
 * The Threads on the Task, the newest first, and the one shown: `shownFirst` when it is one of
 * them, else the newest. Planning opens the first, with the Planner (task 11); Stages open theirs
 * as they run (task 12).
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
  const roles = useQuery(roleQueries.list());
  const openDecisions = useQuery(decisionQueries.open()).data ?? [];
  const planner = usePlanner();
  const [shownId, setShownId] = useState(shownFirst);
  if (!threads) return null;
  const shown = threads.find(({ id }) => id === shownId) ?? threads[0];
  if (!shown) {
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
  const personName = (thread: Thread): string => nameOf(thread.roleKey, roles.data);
  return (
    <aside className="task-conversation" aria-label="Conversation">
      <div className="task-threads" role="group" aria-label="Threads">
        {threads.map((thread) => {
          const waiting = openDecisions.some(({ threadId }) => threadId === thread.id);
          return (
            <button
              key={thread.id}
              type="button"
              className="task-thread"
              aria-pressed={thread.id === shown.id}
              onClick={() => setShownId(thread.id)}
            >
              <Icon name="message-circle" size={13} />
              {threadTitle(thread, personName(thread))}
              {waiting && (
                <span className="task-thread-waiting" title="A Decision waits on you">
                  1<span className="visually-hidden"> Decision waiting on you</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ThreadView
        key={shown.id}
        threadId={shown.id}
        personName={personName(shown)}
        readOnlyReason={task.state === "done" ? DONE_TASK_READ_ONLY : undefined}
      />
    </aside>
  );
}

// Publish removes the Task's worktree, which a session works in, so nothing more can be asked of it.
const DONE_TASK_READ_ONLY =
  "This Task is Done and its working copy has been removed, so you can read this conversation but not continue it. To keep working, start a new Task.";

function nameOf(roleKey: string, roles: readonly Role[] | undefined): string {
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
}
