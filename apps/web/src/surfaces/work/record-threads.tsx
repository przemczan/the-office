import { useQuery } from "@tanstack/react-query";
import type { Role, Thread } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { threadTitle } from "../../shell/conversation/thread-title.ts";
import { ThreadView } from "../../shell/conversation/thread-view.tsx";

/**
 * The Threads beside a record, a Task's or an Initiative's (prototypes/app/task.js), the newest
 * first, and the one shown: `shownFirst` when it is one of them, else the newest.
 */
export function RecordThreads({
  threads,
  shownFirst,
  readOnlyReason,
  empty,
}: {
  readonly threads: readonly Thread[] | undefined;
  readonly shownFirst?: string | undefined;
  /** Why the record's Threads can be read but not continued, once it ended. */
  readonly readOnlyReason: string | undefined;
  /** Shown while the record has no Thread yet. */
  readonly empty: ReactNode;
}): ReactNode {
  const roles = useQuery(roleQueries.list());
  const openDecisions = useQuery(decisionQueries.open()).data ?? [];
  const [shownId, setShownId] = useState(shownFirst);
  if (!threads) return null;
  const shown = threads.find(({ id }) => id === shownId) ?? threads[0];
  if (!shown) {
    return (
      <aside className="task-conversation" aria-label="Conversation">
        {empty}
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
        readOnlyReason={readOnlyReason}
      />
    </aside>
  );
}

function nameOf(roleKey: string, roles: readonly Role[] | undefined): string {
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
}
