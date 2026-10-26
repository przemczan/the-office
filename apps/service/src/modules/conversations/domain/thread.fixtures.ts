import type { Message } from "./message.js";
import { NO_TOKENS, type Thread } from "./thread.js";

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
    openDecision: undefined,
    stageThread: false,
    ...fields,
  };
}

/** What the user wrote in `thread`. */
export function aUserMessage(thread: Thread, text: string, id = crypto.randomUUID()): Message {
  return {
    kind: "user",
    id,
    threadId: thread.id,
    text,
    delivery: "delivered",
    at: new Date("2026-10-25T09:01:00.000Z"),
  };
}
