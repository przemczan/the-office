import { useQuery } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { ContextBar } from "../../shell/conversation/context-bar.tsx";
import { ReadOnlyNote, ThreadComposer } from "../../shell/conversation/thread-composer.tsx";
import { threadTitle } from "../../shell/conversation/thread-title.ts";
import { NO_WRITABLE_THREAD_WORDS } from "./to-line.ts";

/**
 * Under the timeline: the To line, the context label of the Thread it names and the one composer,
 * or why nothing can be written.
 */
export function TimelineFoot({
  threads,
  writable,
  toId,
  closedUnderDraft,
  personName,
  readOnlyReason,
  onDrafting,
  onSent,
  onPick,
}: {
  readonly threads: readonly Thread[];
  readonly writable: readonly Thread[];
  readonly toId: string | undefined;
  readonly closedUnderDraft: string | undefined;
  readonly personName: (thread: Thread) => string;
  /** Why the record's Threads can be read but not continued, once it ended. */
  readonly readOnlyReason: string | undefined;
  readonly onDrafting: (drafting: boolean) => void;
  readonly onSent: (threadId: string) => void;
  readonly onPick: (threadId: string) => void;
}): ReactNode {
  const to = threads.find(({ id }) => id === toId);
  if (readOnlyReason !== undefined || to === undefined) {
    return (
      <div className="timeline-foot">
        <ReadOnlyNote reason={readOnlyReason ?? NO_WRITABLE_THREAD_WORDS} />
      </div>
    );
  }
  const title = (thread: Thread): string => threadTitle(thread, personName(thread));
  // A Thread closed under a draft with nowhere else to go stays named, its composer saying why.
  const offered = writable.some(({ id }) => id === to.id) ? writable : [...writable, to];
  const closed = threads.find(({ id }) => id === closedUnderDraft);
  return (
    <div className="timeline-foot">
      <div className="timeline-to">
        <span aria-hidden="true">To</span>
        <Select
          aria-label="To"
          size="sm"
          value={to.id}
          options={offered.map((thread) => ({ value: thread.id, label: title(thread) }))}
          onChange={onPick}
        />
      </div>
      {closed && (
        <p className="timeline-to-moved" role="status">
          {title(closed)} stopped taking messages, so this now goes to {title(to)}.
        </p>
      )}
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
      <ContextBar thread={latest} personName={personName} />
      <ThreadComposer
        thread={latest}
        personName={personName}
        autoFocus={false}
        onDrafting={onDrafting}
        onSent={onSent}
      />
    </>
  );
}
