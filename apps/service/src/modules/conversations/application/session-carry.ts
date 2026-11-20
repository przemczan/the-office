import { randomUUID } from "node:crypto";
import type { EngineId, EngineSessions, UsageWindowName } from "../../engine/index.js";
import type { ThreadSessionMovedToEngine } from "../domain/conversation-events.js";
import type { Thread, ThreadSession } from "../domain/thread.js";
import { moveSessionToEngine, type ThreadChange } from "../domain/thread-changes.js";

/** Why and where a Thread's session goes on on a Stand-in Engine (spec 5.4). */
export interface SessionCarry {
  readonly from: EngineId;
  readonly to: EngineId;
  readonly window: UsageWindowName;
  readonly resetsAt: Date;
  /** Who went on, in a person's Thread, as its line names them; undefined in a Stage Thread. */
  readonly personName?: string;
}

/** The session carried over and recorded on its Stand-in Engine, and both engines' names. */
export interface CarriedSession {
  readonly session: ThreadSession;
  readonly fromName: string;
  readonly toName: string;
}

/** What carrying a session needs of its runner: the engines, and a change to the Thread saved. */
export interface SessionCarrying {
  readonly engine: Pick<EngineSessions, "nameOf" | "carrySession">;
  readonly change: (
    threadId: string,
    change: (thread: Thread) => ThreadChange<ThreadSessionMovedToEngine>,
  ) => Promise<Thread>;
}

/**
 * Carries the Thread's idle session `sessionId` from `carry.from` to `carry.to`, then records it
 * there with its `engine-switched` line (spec 5.4): copied, then recorded, so at a crash in between
 * the engine the Thread records holds its session. A failed copy throws, leaving it unmoved.
 */
export async function carrySessionToEngine(
  { engine, change }: SessionCarrying,
  threadId: string,
  sessionId: string,
  { from, to, ...why }: SessionCarry,
): Promise<CarriedSession> {
  const names = { fromName: await engine.nameOf(from), toName: await engine.nameOf(to) };
  await engine.carrySession(sessionId, from, to);
  const thread = await change(threadId, (latest) =>
    moveSessionToEngine(
      latest,
      { messageId: randomUUID(), from, to, ...names, ...why },
      new Date(),
    ),
  );
  if (!thread.session) throw new Error(`Thread ${threadId} has no session.`);
  return { session: thread.session, ...names };
}
