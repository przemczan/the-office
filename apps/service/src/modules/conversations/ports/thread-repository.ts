import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Decision } from "../domain/decision.js";
import type { Message } from "../domain/message.js";
import type { Home, Thread } from "../domain/thread.js";
import type { ThreadChange } from "../domain/thread-changes.js";

/** The Thread after a change, with its event, or undefined when nothing changed. */
export interface ThreadUpdate<Event extends DomainEvent> {
  readonly thread: Thread;
  readonly event: Event | undefined;
}

/**
 * Where Threads are kept, each with The Office's log of its messages and the Decisions opened in
 * it, which a change saves with the Thread.
 */
export abstract class ThreadRepository {
  abstract add(thread: Thread): Promise<void>;

  abstract find(id: string): Promise<Thread | undefined>;

  /** The Thread whose engine session now is `sessionId`, if any. */
  abstract findBySession(sessionId: string): Promise<Thread | undefined>;

  /** Every Thread whose person is answering now, in any home. */
  abstract answering(): Promise<readonly Thread[]>;

  /** The home's Threads, the newest started first. */
  abstract listIn(home: Home): Promise<readonly Thread[]>;

  /** The Threads on any Task with the person, by their Role's key, the newest started first. */
  abstract listOnTasksWith(roleKey: string): Promise<readonly Thread[]>;

  /**
   * Applies `change` to the Thread as stored, holding it against other changes until the Thread and
   * the messages it logged are saved, so two changes at once never lose one. Saves nothing when
   * `change` returns undefined; throws ThreadNotFound when there is no such Thread.
   */
  abstract update<Event extends DomainEvent>(
    id: string,
    change: (thread: Thread) => ThreadChange<Event> | undefined,
  ): Promise<ThreadUpdate<Event>>;

  /** The Thread's log, in the order its messages were logged. */
  abstract messages(threadId: string): Promise<readonly Message[]>;

  abstract decision(id: string): Promise<Decision | undefined>;

  /** The Thread's Decisions, open and answered, the first asked first. */
  abstract decisionsIn(threadId: string): Promise<readonly Decision[]>;

  /**
   * The Decisions an Agent asked on the Task that the user answered, in any of its Threads, the
   * first answered first. The Office's own, about limits, guide the next round through the walk.
   */
  abstract answeredOn(taskId: string): Promise<readonly Decision[]>;

  /**
   * Uses up the approval an answered Decision gave a held call, so it lets one call through. False
   * when it was used already or is no such Decision.
   */
  abstract spendApproval(decisionId: string): Promise<boolean>;

  /** Every Decision waiting on the user, the first asked first. */
  abstract openDecisions(): Promise<readonly Decision[]>;
}
