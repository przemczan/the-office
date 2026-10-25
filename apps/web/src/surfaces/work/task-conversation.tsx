import { useQuery } from "@tanstack/react-query";
import type { Role, Task, Thread } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { ThreadView } from "../../shell/conversation/thread-view.tsx";
import { EmptyCard } from "../../shell/item-card.tsx";

/**
 * The Threads on the Task, the newest first, and the one shown. Planning opens the first, with the
 * Planner (task 11); Stages open theirs as they run (task 12).
 */
export function TaskConversation({
  task,
  threads,
}: {
  readonly task: Task;
  readonly threads: readonly Thread[] | undefined;
}): ReactNode {
  const roles = useQuery(roleQueries.list());
  const [shownId, setShownId] = useState<string>();
  if (!threads) return null;
  const shown = threads.find(({ id }) => id === shownId) ?? threads[0];
  if (!shown) {
    const planner = nameOf("planner", roles.data) ?? "the Planner";
    return (
      <aside className="task-conversation" aria-label="Conversation">
        <EmptyCard>
          No conversation on {task.title} yet. Planning opens one with {planner}.
        </EmptyCard>
      </aside>
    );
  }
  return (
    <aside className="task-conversation" aria-label="Conversation">
      <div className="task-threads" role="group" aria-label="Threads">
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className="task-thread"
            aria-pressed={thread.id === shown.id}
            onClick={() => setShownId(thread.id)}
          >
            <Icon name="message-circle" size={13} />
            {thread.title ?? `With ${nameOf(thread.roleKey, roles.data) ?? thread.roleKey}`}
          </button>
        ))}
      </div>
      <ThreadView
        key={shown.id}
        threadId={shown.id}
        personName={nameOf(shown.roleKey, roles.data) ?? shown.roleKey}
      />
    </aside>
  );
}

function nameOf(roleKey: string, roles: readonly Role[] | undefined): string | undefined {
  return roles?.find(({ key }) => key === roleKey)?.card.name;
}
