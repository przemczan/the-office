import { decisionSummary } from "./decision.js";
import { hasAnswered, type ChatThreadActivity } from "./chat-activity.js";
import { worksIn } from "./people-working.js";
import type { Thread } from "./thread.js";

/** What a session waits on: a Decision of the user's, a Consultant's, or the user's reading of a reply. */
export interface ActiveSessionWaitingOn {
  readonly kind: "decision" | "consultant" | "reply";
  /** The open Decision's one-line question; undefined for a reply. */
  readonly question: string | undefined;
}

/** What an active session is about: a Task, an Initiative, or the chat Thread of the user's it sits in. */
export type ActiveSessionSubject =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | {
      readonly kind: "chat";
      readonly threadId: string;
      readonly roleKey: string;
      readonly title: string | undefined;
    };

/** One active session, as Activity reads it from Conversations (spec §2.14, "Sessions"). */
export interface ActiveSession {
  readonly threadId: string;
  readonly roleKey: string;
  readonly subject: ActiveSessionSubject;
  readonly sessionKind: "stage" | "consultation" | "thread" | "chat";
  readonly state: "working" | "waiting";
  readonly waitingOn: ActiveSessionWaitingOn | undefined;
  /** When its turn began, its Decision was asked, or its reply arrived. */
  readonly since: Date;
}

/**
 * The sessions active for the user: each busy Thread (answering, or holding an open Decision) and
 * each of the user's own chats with a reply they haven't seen. Another user's chat is never listed.
 */
export function activeSessionsOf(
  busy: readonly Thread[],
  chats: readonly ChatThreadActivity[],
  userId: string,
): ActiveSession[] {
  const busyById = new Map(busy.map((thread) => [thread.id, thread]));
  const chatById = new Map(chats.map((chat) => [chat.threadId, chat]));
  const ownChat = (threadId: string): boolean => {
    const writer = chatById.get(threadId)?.writerUserId;
    return writer === userId || writer === null;
  };

  const sessions: ActiveSession[] = [];
  for (const thread of busy) {
    const subject = subjectOf(thread, busyById, chatById);
    if (subject.kind === "chat" && !ownChat(subject.threadId)) continue;
    const session = sessionOf(thread, subject);
    if (session) sessions.push(session);
  }
  for (const chat of chats) {
    if (busyById.has(chat.threadId) || !hasAnswered(chat) || !ownChat(chat.threadId)) continue;
    if (chat.unseenAnswerAt === undefined) continue;
    sessions.push({
      threadId: chat.threadId,
      roleKey: chat.roleKey,
      subject: { kind: "chat", threadId: chat.threadId, roleKey: chat.roleKey, title: chat.title },
      sessionKind: "chat",
      state: "waiting",
      waitingOn: { kind: "reply", question: undefined },
      since: chat.unseenAnswerAt,
    });
  }
  return sessions;
}

/**
 * A Consultation in a chat sits with the Thread that asked it, followed back past the Consultations
 * that asked in turn: a chat of the user's, or an Initiative's Thread that called on no Task.
 */
function subjectOf(
  thread: Thread,
  busyById: ReadonlyMap<string, Thread>,
  chatById: ReadonlyMap<string, ChatThreadActivity>,
): ActiveSessionSubject {
  let root = thread;
  const visited = new Set([root.id]);
  while (root.home.kind === "chat" && root.consultation) {
    const asker = busyById.get(root.consultation.askerThreadId);
    if (!asker || visited.has(asker.id)) break;
    visited.add(asker.id);
    root = asker;
  }
  const { home } = root;
  if (home.kind === "task") return { kind: "task", taskId: home.taskId };
  if (home.kind === "initiative") return { kind: "initiative", initiativeId: home.initiativeId };
  return {
    kind: "chat",
    threadId: root.id,
    roleKey: root.roleKey,
    title: chatById.get(root.id)?.title ?? root.title,
  };
}

function sessionOf(thread: Thread, subject: ActiveSessionSubject): ActiveSession | undefined {
  const base = {
    threadId: thread.id,
    roleKey: thread.roleKey,
    subject,
    sessionKind: sessionKindOf(thread),
  };
  if (worksIn(thread)) {
    return {
      ...base,
      state: "working",
      waitingOn: undefined,
      since: thread.answeringSince ?? thread.startedAt,
    };
  }
  const [decision] = thread.openDecisions;
  if (!decision) return undefined;
  return {
    ...base,
    state: "waiting",
    waitingOn: {
      kind: decision.putTo === undefined ? "decision" : "consultant",
      question: decisionSummary(decision),
    },
    since: decision.askedAt,
  };
}

function sessionKindOf(thread: Thread): ActiveSession["sessionKind"] {
  if (thread.consultation) return "consultation";
  if (thread.home.kind === "chat") return "chat";
  return thread.stageThread ? "stage" : "thread";
}
