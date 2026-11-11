import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ConversationTab, TabConsultation, Task } from "@the-office/contracts";
import { Card } from "@the-office/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { openPersonsThread, sendMessage, threadQueries } from "../../api/conversations.ts";
import { Composer } from "../../shell/conversation/composer.tsx";
import { ContextBar } from "../../shell/conversation/context-bar.tsx";
import { startsASessionWords } from "../../shell/conversation/context-words.ts";
import { ReadOnlyNote, ThreadComposer } from "../../shell/conversation/thread-composer.tsx";
import { useThreadDrafts } from "../../shell/conversation/thread-drafts.tsx";
import { ThreadLog } from "../../shell/conversation/thread-view.tsx";
import { EmptyCard } from "../../shell/item-card.tsx";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { SubAgentsAndProcessesLineOf } from "../../shell/sub-agents-and-processes/sub-agents-and-processes-line.tsx";
import { clockOf } from "../../shell/time.ts";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { ToLine } from "./conversation-parts.tsx";
import { plannedElsewhereWords } from "./conversation-tabs.ts";
import { ItsInitiativeLink } from "./its-initiative-link.tsx";
import { WAITS_FOR_ITS_INITIATIVE } from "./needs-you-words.ts";
import { MakeAPlan, planningNoteWords } from "./planning-actions.tsx";

/** What a person's tab reads: their Consultations, then their Thread on the Task. */
export function TabLog({
  task,
  tab,
  personName,
  emptyWords,
  readOnlyReason,
  onShown,
}: {
  readonly task: Task;
  readonly tab: ConversationTab;
  readonly personName: string;
  /** What an empty Thread says. */
  readonly emptyWords: string;
  readonly readOnlyReason: string | undefined;
  /** A tab opens on its newest messages. */
  readonly onShown: () => void;
}): ReactNode {
  useEffect(onShown, [onShown]);
  const planner = usePlanner();
  const plansInAutoMode =
    task.state === "planning" && task.autoMode && tab.roleKey === planner?.key;
  return (
    <>
      {plansInAutoMode && (
        <p className="task-quiet planning-auto-mode-note">
          {planningNoteWords(task, personName)}: once the plan is written, the Task is marked Ready
          without your Confirm.
        </p>
      )}
      {tab.consultations.map((consultation) => (
        <TabConsultationBlock
          key={consultation.threadId}
          consultation={consultation}
          personName={personName}
        />
      ))}
      {tab.planningThreadElsewhere !== null ? (
        <PlannedElsewhere elsewhere={tab.planningThreadElsewhere} personName={personName} />
      ) : tab.threadId !== null ? (
        <PersonsThread threadId={tab.threadId} personName={personName} />
      ) : (
        <NoThreadYet
          task={task}
          personName={personName}
          emptyWords={emptyWords}
          readOnlyReason={readOnlyReason}
        />
      )}
    </>
  );
}

/** The Planner's tab while the Task is planned in its Initiative's planning Thread: a link to it. */
function PlannedElsewhere({
  elsewhere: { initiativeId, threadId },
  personName,
}: {
  readonly elsewhere: NonNullable<ConversationTab["planningThreadElsewhere"]>;
  readonly personName: string;
}): ReactNode {
  return (
    <EmptyCard>
      {plannedElsewhereWords(personName)}
      <div className="task-conversation-start">
        <Link
          className="link-button"
          to="/work/initiatives/$initiativeId"
          params={{ initiativeId }}
          search={{ initiativeThread: threadId }}
        >
          Open the planning Thread
        </Link>
      </div>
    </EmptyCard>
  );
}

function PersonsThread({
  threadId,
  personName,
}: {
  readonly threadId: string;
  readonly personName: string;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId)).data;
  return thread ? <ThreadLog thread={thread} personName={personName} inTimeline /> : null;
}

function NoThreadYet({
  task,
  personName,
  emptyWords,
  readOnlyReason,
}: {
  readonly task: Task;
  readonly personName: string;
  readonly emptyWords: string;
  readonly readOnlyReason: string | undefined;
}): ReactNode {
  const planner = usePlanner();
  if (task.state === "shaping") {
    return (
      <EmptyCard>
        {WAITS_FOR_ITS_INITIATIVE}
        <ItsInitiativeLink task={task} />
      </EmptyCard>
    );
  }
  if (readOnlyReason !== undefined) {
    return <EmptyCard>{`No conversation with ${personName} on ${task.title}.`}</EmptyCard>;
  }
  if (task.state !== "backlog") return <EmptyCard>{emptyWords}</EmptyCard>;
  return planner ? (
    <EmptyCard>
      {planner.card.name} plans from the title
      {task.description !== "" && " and the Description"}, so there is nothing more to write.
      <div className="task-conversation-start">
        <MakeAPlan task={task} />
      </div>
      <p className="task-quiet">
        Or Plan with {planner.card.name} in the head, to talk it through first.
      </p>
    </EmptyCard>
  ) : (
    <EmptyCard>{`No conversation on ${task.title} yet. Planning opens one with the Planner.`}</EmptyCard>
  );
}

/** A Consultation: live while it waits on the Consultant, who alone writes in it; then its note. */
function TabConsultationBlock({
  consultation: { threadId, question, note, answeredAt },
  personName,
}: {
  readonly consultation: TabConsultation;
  readonly personName: string;
}): ReactNode {
  return (
    <section className="tab-consultation" aria-label={`Consultation: ${question}`}>
      <Card variant="sunken" padding="sm">
        <p className="tab-consultation-head">
          Consultation · {answeredAt === null ? `${personName} is on it` : clockOf(answeredAt)}
        </p>
        <p className="tab-consultation-question">{question}</p>
        {note === null ? (
          <PersonsThread threadId={threadId} personName={personName} />
        ) : (
          <MarkdownText text={note} />
        )}
      </Card>
    </section>
  );
}

/**
 * Under a tab: the To line and the composer of the person's Thread, or why nothing can be written.
 * Keyed by person, so a first message on its way stays with its tab.
 */
export function TabFoot({
  task,
  tab,
  personName,
  personLabel,
  readOnlyReason,
  onSent,
}: {
  readonly task: Task;
  readonly tab: ConversationTab;
  readonly personName: string;
  /** Their name and title. */
  readonly personLabel: string;
  readonly readOnlyReason: string | undefined;
  readonly onSent: () => void;
}): ReactNode {
  const firstMessage = useFirstMessage(task.id, tab.roleKey, onSent);
  // Its Initiative's planning Thread is where it is planned: no Thread of the Planner's opens here.
  if (tab.planningThreadElsewhere !== null) return null;
  // Its empty tab already says what it waits for: the note is for a Thread it can't continue.
  if (task.state === "shaping" && tab.threadId === null) return null;
  if (readOnlyReason !== undefined) {
    return (
      <div className="timeline-foot">
        {tab.threadId !== null && (
          <SubAgentsAndProcessesLineOf threadId={tab.threadId} personName={personName} />
        )}
        <ReadOnlyNote reason={readOnlyReason} />
      </div>
    );
  }
  // Until it is taken, even once its Thread shows, so a refusal keeps the message and says why.
  if (tab.threadId === null || firstMessage.isPending || firstMessage.isError) {
    // Backlog has no Thread to open: Planning opens it.
    return task.state === "backlog" ? null : (
      <FirstMessage
        task={task}
        roleKey={tab.roleKey}
        firstMessage={firstMessage}
        personName={personName}
        personLabel={personLabel}
      />
    );
  }
  return (
    <WritingInTab
      key={tab.threadId}
      threadId={tab.threadId}
      personName={personName}
      personLabel={personLabel}
      onSent={onSent}
    />
  );
}

/**
 * The first message in a tab with no Thread: the Thread opens as it is sent, so looking at a tab
 * opens nothing. Opening finds a Thread already open, so sending again after a refusal is safe.
 */
function useFirstMessage(taskId: string, roleKey: string, onSent: () => void) {
  const queryClient = useQueryClient();
  const threadDrafts = useThreadDrafts();
  const draftKey = `${taskId}/${roleKey}`;
  const sending = useMutation({
    mutationFn: async (text: string) => {
      const thread = await openPersonsThread(taskId, roleKey);
      queryClient.setQueryData(threadQueries.one(thread.id).queryKey, thread);
      return sendMessage(thread.id, { text });
    },
    onSuccess: async (answering) => {
      threadDrafts.clear(draftKey);
      queryClient.setQueryData(threadQueries.one(answering.id).queryKey, answering);
      onSent();
      await queryClient.invalidateQueries(threadQueries.conversationOnTask(taskId));
    },
  });
  return { ...sending, draftKey };
}

function FirstMessage({
  task,
  roleKey,
  firstMessage,
  personName,
  personLabel,
}: {
  readonly task: Task;
  readonly roleKey: string;
  readonly firstMessage: ReturnType<typeof useFirstMessage>;
  readonly personName: string;
  readonly personLabel: string;
}): ReactNode {
  const { draftKey, error, mutateAsync } = firstMessage;
  const threadDrafts = useThreadDrafts();
  const firstBrief = useQuery(threadQueries.firstBrief(task.id, roleKey)).data;
  const [startingDraft] = useState(() => threadDrafts.waitingIn(draftKey));
  const leaveDraft = useCallback(
    (draft: string) => threadDrafts.leave(draftKey, draft),
    [threadDrafts, draftKey],
  );
  return (
    <div className="timeline-foot">
      <ToLine roleKey={roleKey} personName={personName} personLabel={personLabel} />
      {error && <RefusalAlert title="The message wasn't sent" error={error} />}
      <Composer
        placeholder={composerPlaceholder(personName)}
        busy={false}
        busyHint=""
        startingDraft={startingDraft}
        autoFocus={false}
        onDraftChange={leaveDraft}
        onSend={(text) => mutateAsync(text)}
      />
      {firstBrief && (
        <div className="context-bar">
          <span className="context-label" aria-label="Context">
            {startsASessionWords(firstBrief.tokens)}
          </span>
        </div>
      )}
    </div>
  );
}

function composerPlaceholder(personName: string): string {
  return `Ask ${personName} anything about this Task…`;
}

/** Keyed by Thread, with its draft kept, so each person's stays theirs as the tabs change. */
function WritingInTab({
  threadId,
  personName,
  personLabel,
  onSent,
}: {
  readonly threadId: string;
  readonly personName: string;
  readonly personLabel: string;
  readonly onSent: () => void;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId)).data;
  if (!thread) return null;
  return (
    <div className="timeline-foot">
      <ToLine
        roleKey={thread.roleKey}
        personName={personName}
        personLabel={personLabel}
        context={thread.context}
      />
      <ThreadComposer
        thread={thread}
        personName={personName}
        placeholder={composerPlaceholder(personName)}
        autoFocus={false}
        keepsDraft
        onSent={onSent}
      />
      <ContextBar thread={thread} personName={personName} />
    </div>
  );
}
