import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  chatActivitySchema,
  decisionListSchema,
  fireAlarmLiftsSchema,
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
  threadListSchema,
  threadSchema,
  threadWebEventSchema,
  type ContextOverride,
  type DecisionAnswer,
  type FireAlarmLifts,
  type Home,
  type NewMessage,
  type OfficeInstructions,
  type ProcessOutput,
  type Proposal,
  type ProposalApplication,
  type SizeThreshold,
  type SubAgentMessages,
  type Thread,
  type ThreadWebEvent,
  type TokenTotals,
} from "@the-office/contracts";
import { deleteFromApiReturning, getFromApi, sendToApi } from "./api-client.ts";
import type { EventCacheUpdates, EventInvalidations } from "./event-stream-provider.tsx";
import { FIRE_ALARM, TASKS } from "./work.ts";

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
  /** The person's chat, the newest Thread first. */
  inChat: (roleKey: string) =>
    queryOptions({
      queryKey: [...THREADS, "chat", roleKey],
      queryFn: ({ signal }) =>
        getFromApi(`/chats/${encodeURIComponent(roleKey)}/threads`, threadListSchema, signal),
    }),
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
  /** The person's Threads on every Task, the newest first. */
  onTasksWith: (roleKey: string) =>
    queryOptions({
      queryKey: [...THREADS, "on-tasks", roleKey],
      queryFn: ({ signal }) =>
        getFromApi(`/roles/${encodeURIComponent(roleKey)}/task-threads`, threadListSchema, signal),
    }),
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
export function answerDecision(id: string, answer: DecisionAnswer): Promise<Thread> {
  return sendToApi("POST", `/decisions/${encodeURIComponent(id)}/answer`, answer, threadSchema);
}

/** The Conversations events that carry what changed, which `threadEventCacheUpdates` applies. */
type CarryingEventType = "thread.tokens-counted";

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
  "thread.started": () => [THREADS],
  "thread.renamed": () => [THREADS],
  "thread.seen": () => [THREADS],
  "thread.messages-logged": () => [THREADS],
  "thread.turn-ended": () => [THREADS],
  "thread.delivery-marked": () => [THREADS],
  "thread.override-chosen": () => [THREADS],
  "thread.decision-opened": () => [THREADS, DECISIONS, TASKS],
  "thread.decision-answered": () => [THREADS, DECISIONS, TASKS],
  "thread.decision-reopened": () => [THREADS, DECISIONS, TASKS],
  "thread.proposal-drafted": () => [THREADS, [...PROPOSALS, "open"]],
  "thread.proposal-applied": () => [THREADS, PROPOSALS],
  "thread.proposal-declined": () => [THREADS, PROPOSALS],
  "context-policy.size-threshold-changed": () => [SIZE_THRESHOLD, THREADS],
  "office-instructions.changed": () => [OFFICE_INSTRUCTIONS],
};

/**
 * A running turn's tokens change just that Thread, wherever it is cached, and with it its Task's
 * total, refetching no log: a long turn counts many times.
 */
export const threadEventCacheUpdates: Readonly<
  Record<CarryingEventType, EventCacheUpdates[string]>
> = {
  "thread.tokens-counted": (event, queryClient) => {
    const counted = threadWebEventSchema.parse(event);
    if (counted.type !== "thread.tokens-counted") return;
    showTokens(queryClient, counted.threadId, counted.home, counted.tokens);
  },
};

function showTokens(
  queryClient: QueryClient,
  threadId: string,
  home: Home,
  tokens: TokenTotals,
): void {
  queryClient.setQueryData(
    threadQueries.one(threadId).queryKey,
    (thread) => thread && { ...thread, tokens },
  );
  // A list without the Thread stays as it is, so nothing showing it renders again.
  const inList = (threads: Thread[] | undefined): Thread[] | undefined =>
    threads?.some(({ id }) => id === threadId)
      ? threads.map((thread) => (thread.id === threadId ? { ...thread, tokens } : thread))
      : threads;
  queryClient.setQueryData(homeThreadsQuery(home).queryKey, inList);
  // Every person's list of their Threads on Tasks, since the event doesn't name whose it is.
  queryClient.setQueriesData<Thread[]>({ queryKey: [...THREADS, "on-tasks"] }, inList);
}

/** The Threads of the home, the newest first. */
export function homeThreadsQuery(home: Home) {
  switch (home.kind) {
    case "chat":
      return threadQueries.inChat(home.roleKey);
    case "task":
      return threadQueries.onTask(home.taskId);
    case "initiative":
      return threadQueries.onInitiative(home.initiativeId);
  }
}

function threadPath(id: string): `/${string}` {
  return `/threads/${encodeURIComponent(id)}`;
}

function proposalPath(id: string): `/${string}` {
  return `/proposals/${encodeURIComponent(id)}`;
}
