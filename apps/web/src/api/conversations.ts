import {
  queryOptions,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  chatActivitySchema,
  chatThreadPageSchema,
  decisionListSchema,
  fireAlarmLiftsSchema,
  messageImageSchema,
  messageListSchema,
  officeInstructionsSchema,
  peopleWorkingSchema,
  processOutputSchema,
  proposalListSchema,
  proposalSchema,
  sizeThresholdSchema,
  firstBriefSchema,
  subAgentMessagesSchema,
  subAgentsAndProcessesSchema,
  taskConversationSchema,
  taskThreadPageSchema,
  threadListSchema,
  threadSchema,
  threadWebEventSchema,
  type ContextOverride,
  type DecisionFormAnswer,
  type FireAlarmLifts,
  type Home,
  type MessageImage,
  type NewMessage,
  type OfficeInstructions,
  type ProcessOutput,
  type Proposal,
  type ProposalApplication,
  type SizeThreshold,
  type ChatThreadPage,
  type SubAgentMessages,
  type TaskThreadPage,
  type Thread,
  type ThreadSummary,
  type ThreadWebEvent,
} from "@the-office/contracts";
import { deleteFromApiReturning, getFromApi, sendFileToApi, sendToApi } from "./api-client.ts";
import { changeRows, pagedQueryOptions, rowsOf } from "./pages.ts";
import type { EventCacheUpdates, EventInvalidations } from "./event-stream-provider.tsx";
import { FIRE_ALARM, PERSON_TASKS, TASKS } from "./work.ts";

const THREADS = ["threads"] as const;
const DECISIONS = ["decisions"] as const;
const PROPOSALS = ["proposals"] as const;
const SIZE_THRESHOLD = ["settings", "size-threshold"] as const;
const OFFICE_INSTRUCTIONS = ["settings", "office-instructions"] as const;

export const threadQueries = {
  /** Where each person's chat stands, under the key every Thread's event refreshes. */
  chatActivity: () =>
    queryOptions({
      queryKey: [...THREADS, "chat-activity"],
      queryFn: ({ signal }) => getFromApi("/chats/activity", chatActivitySchema, signal),
    }),
  /** Who is working on each Task now, under the key every Thread's event refreshes. */
  peopleWorking: () =>
    queryOptions({
      queryKey: [...THREADS, "people-working"],
      queryFn: ({ signal }) => getFromApi("/people-working", peopleWorkingSchema, signal),
    }),
  /**
   * The person's chat, the newest Thread first, a page at a time; each row a summary, which
   * `one` reads in full for the Thread that opens.
   */
  inChat: (roleKey: string) =>
    pagedQueryOptions(
      [...THREADS, "chat", roleKey],
      `/chats/${encodeURIComponent(roleKey)}/threads`,
      chatThreadPageSchema,
    ),
  /** The Threads on a Task, the newest first. */
  onTask: (taskId: string) =>
    queryOptions({
      queryKey: [...THREADS, "task", taskId],
      queryFn: ({ signal }) =>
        getFromApi(`/tasks/${encodeURIComponent(taskId)}/threads`, threadListSchema, signal),
    }),
  /** Who has a tab in the Task's conversation; under the Threads' key, as their events change it. */
  conversationOnTask: (taskId: string) =>
    queryOptions({
      queryKey: [...THREADS, "task", taskId, "conversation"],
      queryFn: ({ signal }) =>
        getFromApi(
          `/tasks/${encodeURIComponent(taskId)}/conversation`,
          taskConversationSchema,
          signal,
        ),
    }),
  /** Not under the Threads' key: it reads the Task's diff, and Thread events come by the dozen. */
  firstBrief: (taskId: string, roleKey: string) =>
    queryOptions({
      queryKey: ["first-brief", taskId, roleKey],
      queryFn: ({ signal }) =>
        getFromApi(
          `/tasks/${encodeURIComponent(taskId)}/conversation/${encodeURIComponent(roleKey)}/brief`,
          firstBriefSchema,
          signal,
        ),
    }),
  onInitiative: (initiativeId: string) =>
    queryOptions({
      queryKey: [...THREADS, "initiative", initiativeId],
      queryFn: ({ signal }) =>
        getFromApi(
          `/initiatives/${encodeURIComponent(initiativeId)}/threads`,
          threadListSchema,
          signal,
        ),
    }),
  /** The person's Threads on every Task, the newest first, a page at a time, each with its Task. */
  onTasksWith: (roleKey: string) =>
    pagedQueryOptions(
      [...THREADS, "on-tasks", roleKey],
      `/roles/${encodeURIComponent(roleKey)}/task-threads`,
      taskThreadPageSchema,
    ),
  one: (id: string) =>
    queryOptions({
      queryKey: [...THREADS, id],
      queryFn: ({ signal }) => getFromApi(threadPath(id), threadSchema, signal),
    }),
  /** The Office's log of the Thread, oldest first. */
  messages: (id: string) =>
    queryOptions({
      queryKey: [...THREADS, id, "messages"],
      queryFn: ({ signal }) => getFromApi(`${threadPath(id)}/messages`, messageListSchema, signal),
    }),
  /**
   * The Sub-agents and Processes of the Thread's current session (spec 2.9), as they started. Under
   * the Thread's key, so its events read it again, as a fresh session takes the old ones away.
   */
  subAgentsAndProcesses: (id: string) =>
    queryOptions({
      queryKey: [...THREADS, id, "sub-agents-and-processes"],
      queryFn: ({ signal }) =>
        getFromApi(
          `${threadPath(id)}/sub-agents-and-processes`,
          subAgentsAndProcessesSchema,
          signal,
        ),
    }),
};

/** A Sub-agent's messages and tool calls after `after`; read by the view, never cached. */
export function readSubAgentMessages(
  threadId: string,
  callId: string,
  after: number,
  signal?: AbortSignal,
): Promise<SubAgentMessages> {
  return getFromApi(
    `${threadPath(threadId)}/sub-agents/${encodeURIComponent(callId)}/messages?after=${after}`,
    subAgentMessagesSchema,
    signal,
  );
}

/** A Process's output after `after`; read by the view, never cached. */
export function readProcessOutput(
  threadId: string,
  callId: string,
  after: number,
  signal?: AbortSignal,
): Promise<ProcessOutput> {
  return getFromApi(
    `${threadPath(threadId)}/processes/${encodeURIComponent(callId)}/output?after=${after}`,
    processOutputSchema,
    signal,
  );
}

/** Settings › Office limits: the Context policy's size threshold, in tokens. */
export const sizeThresholdQuery = () =>
  queryOptions({
    queryKey: SIZE_THRESHOLD,
    queryFn: ({ signal }) => getFromApi("/settings/size-threshold", sizeThresholdSchema, signal),
  });

export function changeSizeThreshold(sizeThreshold: number): Promise<SizeThreshold> {
  return sendToApi("PUT", "/settings/size-threshold", { sizeThreshold }, sizeThresholdSchema);
}

/** Settings › Office instructions: the text every new session gets. */
export const officeInstructionsQuery = () =>
  queryOptions({
    queryKey: OFFICE_INSTRUCTIONS,
    queryFn: ({ signal }) =>
      getFromApi("/settings/office-instructions", officeInstructionsSchema, signal),
  });

export function changeOfficeInstructions(officeInstructions: string): Promise<OfficeInstructions> {
  return sendToApi(
    "PUT",
    "/settings/office-instructions",
    { officeInstructions },
    officeInstructionsSchema,
  );
}

export const decisionQueries = {
  /** Every Decision waiting on the user, the first asked first: what Waiting on you is made of. */
  open: () =>
    queryOptions({
      queryKey: [...DECISIONS, "open"],
      queryFn: ({ signal }) => getFromApi("/decisions/open", decisionListSchema, signal),
    }),
  /**
   * Every Decision on the Task nobody has answered, the first asked first: those waiting on the
   * user, and those with a Consultant (`putTo`), which the user may take over.
   */
  unanswered: (taskId: string) =>
    queryOptions({
      queryKey: [...DECISIONS, "unanswered", taskId],
      queryFn: ({ signal }) =>
        getFromApi(
          `/tasks/${encodeURIComponent(taskId)}/decisions/unanswered`,
          decisionListSchema,
          signal,
        ),
    }),
};

export const proposalQueries = {
  one: (id: string) =>
    queryOptions({
      queryKey: [...PROPOSALS, id],
      queryFn: ({ signal }) => getFromApi(proposalPath(id), proposalSchema, signal),
    }),
  /** Every open Proposal, the newest first: what a page offers to apply besides its card. */
  open: () =>
    queryOptions({
      queryKey: [...PROPOSALS, "open"],
      queryFn: ({ signal }) => getFromApi("/proposals/open", proposalListSchema, signal),
    }),
};

/**
 * Applies the Proposal: as drafted, or a new Role as the user edited it before hiring (a card from
 * scratch, a name for a preset's Role). A refusal leaves it open.
 */
export function applyProposal(id: string, application: ProposalApplication): Promise<Proposal> {
  return sendToApi("POST", `${proposalPath(id)}/apply`, application, proposalSchema);
}

/** "Not now": the Proposal is declined, and nothing changes. */
export function declineProposal(id: string): Promise<Proposal> {
  return sendToApi("POST", `${proposalPath(id)}/decline`, {}, proposalSchema);
}

/** A fresh Thread in the person's chat. */
/**
 * The Threads whose Agent may act while the fire alarm is on (spec §2.8); under the alarm's key,
 * so its sounding and its all clear read them again.
 */
export const fireAlarmLiftsQuery = () =>
  queryOptions({
    queryKey: [...FIRE_ALARM, "lifts"],
    queryFn: ({ signal }) => getFromApi("/fire-alarm/lifts", fireAlarmLiftsSchema, signal),
  });

/** "Let <name> act in this thread": its Agent runs tools until the all clear. */
export function liftTheAlarm(threadId: string): Promise<FireAlarmLifts> {
  return sendToApi("PUT", `/fire-alarm/lifts/${threadId}`, {}, fireAlarmLiftsSchema);
}

/** "Take it back": the Thread's Agent runs no tools again while the alarm is on. */
export function takeTheLiftBack(threadId: string): Promise<FireAlarmLifts> {
  return deleteFromApiReturning(`/fire-alarm/lifts/${threadId}`, fireAlarmLiftsSchema);
}

export function startChatThread(roleKey: string): Promise<Thread> {
  return sendToApi("POST", `/chats/${encodeURIComponent(roleKey)}/threads`, {}, threadSchema);
}

/** Finds or opens the person's one Thread on the Task. */
export function openPersonsThread(taskId: string, roleKey: string): Promise<Thread> {
  return sendToApi(
    "POST",
    `/tasks/${encodeURIComponent(taskId)}/conversation/${encodeURIComponent(roleKey)}/thread`,
    {},
    threadSchema,
  );
}

/**
 * The person answers in the background; the answer comes into the log as it is written. The
 * message says whose Handover note it started from when a Link card gave it.
 */
export function sendMessage(id: string, message: NewMessage): Promise<Thread> {
  return sendToApi("POST", `${threadPath(id)}/messages`, message, threadSchema);
}

/**
 * Stores an image for the next message of the Thread, before the message itself is sent with the
 * Attachment id it answers (`NewMessage.images`).
 */
export function uploadMessageImage(threadId: string, file: File): Promise<MessageImage> {
  return sendFileToApi(`${threadPath(threadId)}/images`, file, messageImageSchema);
}

export function renameThread(id: string, title: string): Promise<Thread> {
  return sendToApi("PUT", `${threadPath(id)}/title`, { title }, threadSchema);
}

/** "Start fresh" or "Continue anyway" for the next message; null goes back to the policy. */
export function chooseContextOverride(
  id: string,
  override: ContextOverride | null,
): Promise<Thread> {
  return sendToApi("PUT", `${threadPath(id)}/context-override`, { override }, threadSchema);
}

/**
 * Allow changes in the Caretaker's Thread, as the user confirmed (spec §2.4): its session ends, and
 * the next message starts one reaching the workstation but secrets.
 */
export function allowChanges(id: string): Promise<Thread> {
  return sendToApi("PUT", `${threadPath(id)}/allow-changes`, {}, threadSchema);
}

/** The newest message of the chat Thread the web has shown: what the user has seen of it. */
export function markThreadSeen(id: string, messageId: string): Promise<Thread> {
  return sendToApi("PUT", `${threadPath(id)}/seen`, { messageId }, threadSchema);
}

/** "Switch off": the Thread's session ends at once, and the Caretaker only reads again. */
export function switchChangesOff(id: string): Promise<Thread> {
  return deleteFromApiReturning(`${threadPath(id)}/allow-changes`, threadSchema);
}

/** The person who asked takes the answer in their Thread, which this answers with. */
export function answerDecision(id: string, answer: DecisionFormAnswer): Promise<Thread> {
  return sendToApi("POST", `/decisions/${encodeURIComponent(id)}/answer`, answer, threadSchema);
}

/** The Conversations events that carry what changed, which `threadEventCacheUpdates` applies. */
type CarryingEventType = "thread.tokens-counted" | "thread.context-read";

/**
 * A session's Sub-agents and Processes (spec 2.9): each event carries the item or the new part,
 * which only the line and the view of that Thread apply, subscribed to for it while they show
 * (`shell/sub-agents-and-processes/`); nothing else refetches.
 */
type SubAgentAndProcessEventType =
  | "thread.sub-agent-started"
  | "thread.sub-agent-changed"
  | "thread.sub-agent-ended"
  | "thread.process-started"
  | "thread.process-ended"
  | "thread.sub-agent-messages"
  | "thread.process-output";

/**
 * Every other Conversations event makes the Threads stale: ["threads"] covers each home's list,
 * each Thread and its log. A Decision's events also make ["decisions"] stale, kept apart so the
 * many events of a turn don't refetch the open Decisions, and ["tasks"], as a waiting Decision is
 * one line of a Task's "Before Ready" checklist. A Proposal applied or declined makes ["proposals"]
 * stale, read by the hire page that edits one.
 */
export const threadEventInvalidations: Readonly<
  Record<
    Exclude<ThreadWebEvent["type"], CarryingEventType | SubAgentAndProcessEventType>,
    EventInvalidations[string]
  >
> = {
  // A person's Work tab names their Tasks by their Threads' titles.
  "thread.started": () => [THREADS, PERSON_TASKS],
  "thread.renamed": () => [THREADS, PERSON_TASKS],
  "thread.seen": () => [THREADS],
  "thread.messages-logged": () => [THREADS],
  "thread.turn-ended": () => [THREADS],
  "thread.delivery-marked": () => [THREADS],
  "thread.override-chosen": () => [THREADS],
  "thread.decision-opened": () => [THREADS, DECISIONS, TASKS],
  "thread.decision-answered": () => [THREADS, DECISIONS, TASKS],
  "thread.decision-reopened": () => [THREADS, DECISIONS, TASKS],
  "thread.decision-closed": () => [THREADS, DECISIONS, TASKS],
  "thread.proposal-drafted": () => [THREADS, [...PROPOSALS, "open"]],
  "thread.proposal-applied": () => [THREADS, PROPOSALS],
  "thread.proposal-declined": () => [THREADS, PROPOSALS],
  "context-policy.size-threshold-changed": () => [SIZE_THRESHOLD, THREADS],
  "office-instructions.changed": () => [OFFICE_INSTRUCTIONS],
};

/**
 * A running turn's tokens and context readings change just that Thread, wherever it is cached, and
 * with it its Task's total, refetching no log: a long turn counts many times.
 */
export const threadEventCacheUpdates: Readonly<
  Record<CarryingEventType, EventCacheUpdates[string]>
> = {
  "thread.tokens-counted": (event, queryClient) => {
    const counted = threadWebEventSchema.parse(event);
    if (counted.type !== "thread.tokens-counted") return;
    const { tokens } = counted;
    changeThread(queryClient, counted.threadId, counted.home, {
      thread: (thread) => ({ ...thread, tokens }),
      summary: (summary) => ({ ...summary, tokens }),
    });
  },
  "thread.context-read": (event, queryClient) => {
    const read = threadWebEventSchema.parse(event);
    if (read.type !== "thread.context-read") return;
    const { contextTokens, contextWindow } = read;
    changeThread(queryClient, read.threadId, read.home, {
      thread: (thread) => ({
        ...thread,
        context: { ...thread.context, contextTokens, contextWindow },
      }),
      summary: (summary) => ({ ...summary, context: { ...summary.context, contextTokens } }),
    });
  },
};

/** A change to a Thread, as it reads in full and as a list's row shows it. */
interface ThreadChange {
  readonly thread: (thread: Thread) => Thread;
  readonly summary: (summary: ThreadSummary) => ThreadSummary;
}

function changeThread(
  queryClient: QueryClient,
  threadId: string,
  home: Home,
  change: ThreadChange,
): void {
  queryClient.setQueryData(
    threadQueries.one(threadId).queryKey,
    (thread) => thread && change.thread(thread),
  );
  // A list without the Thread stays as it is, so nothing showing it renders again.
  const changedIn = <Row extends { readonly id: string }>(
    rows: Row[] | undefined,
    toRow: (row: Row) => Row,
  ): Row[] | undefined =>
    rows?.some(({ id }) => id === threadId)
      ? rows.map((row) => (row.id === threadId ? toRow(row) : row))
      : rows;
  const inPages = <Page extends ChatThreadPage | TaskThreadPage>(
    toRow: (row: Page["rows"][number]) => Page["rows"][number],
  ) => {
    return (pages: InfiniteData<Page> | undefined): InfiniteData<Page> | undefined =>
      rowsOf(pages).some(({ id }) => id === threadId)
        ? changeRows(pages, (rows) => changedIn(rows, toRow) ?? rows)
        : pages;
  };
  switch (home.kind) {
    case "chat":
      queryClient.setQueryData(
        threadQueries.inChat(home.roleKey).queryKey,
        inPages<ChatThreadPage>(change.summary),
      );
      break;
    case "task":
      queryClient.setQueryData(threadQueries.onTask(home.taskId).queryKey, (threads) =>
        changedIn(threads, change.thread),
      );
      // Every person's list of their Threads on Tasks, since the event doesn't name whose it is.
      queryClient.setQueriesData<InfiniteData<TaskThreadPage>>(
        { queryKey: [...THREADS, "on-tasks"] },
        inPages<TaskThreadPage>((row) => ({ ...row, ...change.summary(row) })),
      );
      break;
    case "initiative":
      queryClient.setQueryData(threadQueries.onInitiative(home.initiativeId).queryKey, (threads) =>
        changedIn(threads, change.thread),
      );
  }
}

/** The key of the list of the home's Threads, the newest first. */
export function homeThreadsKey(home: Home): QueryKey {
  switch (home.kind) {
    case "chat":
      return threadQueries.inChat(home.roleKey).queryKey;
    case "task":
      return threadQueries.onTask(home.taskId).queryKey;
    case "initiative":
      return threadQueries.onInitiative(home.initiativeId).queryKey;
  }
}

function threadPath(id: string): `/${string}` {
  return `/threads/${encodeURIComponent(id)}`;
}

function proposalPath(id: string): `/${string}` {
  return `/proposals/${encodeURIComponent(id)}`;
}
