import { TurnEnded } from "./conversation-events.js";
import type { Message } from "./message.js";
import { NO_TOKENS, type Thread, type ThreadSession } from "./thread.js";
import type { ThreadChange } from "./thread-changes.js";
import type { UserRef } from "./user.js";
import { ANN_LEE } from "./user.fixtures.js";

/** A Thread in the Planner's chat with nothing said yet. */
export function aThread(fields: Partial<Thread> = {}): Thread {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    home: { kind: "chat", roleKey: "planner" },
    roleKey: "planner",
    title: undefined,
    state: "waiting",
    session: undefined,
    override: undefined,
    tokens: NO_TOKENS,
    runningTurnTokens: NO_TOKENS,
    startedAt: new Date("2026-10-25T09:00:00.000Z"),
    openDecisions: [],
    stageThread: false,
    consultation: undefined,
    ...fields,
  };
}

/** Takes the version off the Thread's session, as one stored before the Office instructions. */
export function storedBeforeOfficeInstructions(thread: Thread): ThreadChange<TurnEnded> {
  const session = { ...thread.session, officeInstructionsVersion: undefined };
  const stored: Thread = { ...thread, session: session as unknown as ThreadSession };
  return { thread: stored, logged: [], event: new TurnEnded(stored, new Date()) };
}

/** What the user `writtenBy`, Ann Lee unless named, wrote in `thread`. */
export function aUserMessage(
  thread: Thread,
  text: string,
  id = crypto.randomUUID(),
  writtenBy: UserRef | null = ANN_LEE,
): Message {
  return {
    kind: "user",
    id,
    threadId: thread.id,
    text,
    delivery: "delivered",
    at: new Date("2026-10-25T09:01:00.000Z"),
    writtenBy,
  };
}
