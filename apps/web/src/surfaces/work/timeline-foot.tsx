import { useQuery } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { Avatar, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { ContextBar } from "../../shell/conversation/context-bar.tsx";
import { ReadOnlyNote, ThreadComposer } from "../../shell/conversation/thread-composer.tsx";
import { threadTitle } from "../../shell/conversation/thread-title.ts";

/**
 * Under the timeline: the To line, the one composer and the context label of the Thread it names,
 * or why nothing can be written.
 */
export function TimelineFoot({
  threads,
  toId,
  personName,
  personLabel,
  readOnlyReason,
  onDrafting,
  onSent,
  onPick,
}: {
  /** In the order they started. */
  readonly threads: readonly Thread[];
  readonly toId: string | undefined;
  readonly personName: (thread: Thread) => string;
  readonly personLabel: (thread: Thread) => string;
  /** Why the record's Threads can be read but not continued, once it ended. */
  readonly readOnlyReason: string | undefined;
  readonly onDrafting: (drafting: boolean) => void;
  readonly onSent: (threadId: string) => void;
  readonly onPick: (threadId: string) => void;
}): ReactNode {
  if (readOnlyReason !== undefined) {
    return (
      <div className="timeline-foot">
        <ReadOnlyNote reason={readOnlyReason} />
      </div>
    );
  }
  const to = threads.find(({ id }) => id === toId);
  if (to === undefined) return null;
  const title = (thread: Thread): string => threadTitle(thread, personName(thread));
  return (
    <div className="timeline-foot">
      <div className="timeline-to">
        <span aria-hidden="true">To</span>
        {/* The person shows; the list over them, unseen, is what is pressed and read out. */}
        <span className="timeline-to-pick">
          <span className="timeline-to-shown" aria-hidden="true">
            <Avatar name={personName(to)} size="xs" />
            <strong>{personLabel(to)}</strong>
            {to.title !== null && <span className="timeline-to-place">, in {to.title}</span>}
            {threads.length > 1 && <Icon name="chevron-down" size={12} />}
          </span>
          <select aria-label="To" value={to.id} onChange={(event) => onPick(event.target.value)}>
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {title(thread)}
              </option>
            ))}
          </select>
        </span>
      </div>
      <WritingTo thread={to} personName={personName(to)} onDrafting={onDrafting} onSent={onSent} />
    </div>
  );
}

/**
 * Stays mounted as the To line moves, so the draft goes with it. The list's copy of the Thread
 * stands in while its own loads, as the composer must not go away meanwhile.
 */
function WritingTo({
  thread,
  personName,
  onDrafting,
  onSent,
}: {
  readonly thread: Thread;
  readonly personName: string;
  readonly onDrafting: (drafting: boolean) => void;
  readonly onSent: (threadId: string) => void;
}): ReactNode {
  const latest = useQuery(threadQueries.one(thread.id)).data ?? thread;
  return (
    <>
      <ThreadComposer
        thread={latest}
        personName={personName}
        autoFocus={false}
        onDrafting={onDrafting}
        onSent={onSent}
      />
      <ContextBar thread={latest} personName={personName} />
    </>
  );
}
