import { useQuery } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { ContextBar } from "../../shell/conversation/context-bar.tsx";
import { ReadOnlyNote, ThreadComposer } from "../../shell/conversation/thread-composer.tsx";
import { threadTitle } from "../../shell/conversation/thread-title.ts";
import { SubAgentsAndProcessesLine } from "../../shell/sub-agents-and-processes/sub-agents-and-processes-line.tsx";
import { ToLine } from "./conversation-parts.tsx";

/**
 * Under a tab: the To line, the composer and the context label of the Thread it names, or why
 * nothing can be written, each under the line of that Thread's Sub-agents and Processes.
 */
export function InitiativeTabFoot({
  threads,
  toId,
  personName,
  personLabel,
  readOnlyReason,
  onDrafting,
  onSent,
  onChoose,
}: {
  /** The person's, the oldest first. */
  readonly threads: readonly Thread[];
  readonly toId: string | undefined;
  readonly personName: string;
  readonly personLabel: string;
  /** Why the Initiative's Threads can be read but not continued, once it ended. */
  readonly readOnlyReason: string | undefined;
  readonly onDrafting: (drafting: boolean) => void;
  readonly onSent: (threadId: string) => void;
  readonly onChoose: (threadId: string) => void;
}): ReactNode {
  const to = threads.find(({ id }) => id === toId);
  if (readOnlyReason !== undefined) {
    return (
      <div className="timeline-foot">
        {to && <SubAgentsAndProcessesLine thread={to} personName={personName} />}
        <ReadOnlyNote reason={readOnlyReason} />
      </div>
    );
  }
  // An empty tab says where its first Thread starts.
  if (to === undefined) return null;
  return (
    <WritingTo
      key={to.id}
      thread={to}
      choices={threads}
      personName={personName}
      personLabel={personLabel}
      onDrafting={onDrafting}
      onSent={onSent}
      onChoose={onChoose}
    />
  );
}

/**
 * Keyed by Thread, with its draft kept, so each Thread's stays its own as the To line and the tabs
 * change. The list's copy of the Thread stands in while its own loads.
 */
function WritingTo({
  thread,
  choices,
  personName,
  personLabel,
  onDrafting,
  onSent,
  onChoose,
}: {
  readonly thread: Thread;
  /** The person's Threads the To line offers. */
  readonly choices: readonly Thread[];
  readonly personName: string;
  readonly personLabel: string;
  readonly onDrafting: (drafting: boolean) => void;
  readonly onSent: (threadId: string) => void;
  readonly onChoose: (threadId: string) => void;
}): ReactNode {
  const latest = useQuery(threadQueries.one(thread.id)).data ?? thread;
  return (
    <div className="timeline-foot">
      <ToLine
        roleKey={latest.roleKey}
        personName={personName}
        personLabel={personLabel}
        place={latest.title}
        context={latest.context}
        choice={
          choices.length > 1
            ? {
                threads: choices.map((choice) => ({
                  threadId: choice.id,
                  title: threadTitle(choice, personName),
                })),
                chosenId: latest.id,
                onChoose,
              }
            : undefined
        }
      />
      <ThreadComposer
        thread={latest}
        personName={personName}
        autoFocus={false}
        keepsDraft
        onDrafting={onDrafting}
        onSent={onSent}
      />
      <ContextBar thread={latest} personName={personName} />
    </div>
  );
}
