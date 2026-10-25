import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Message } from "../domain/message.js";
import type { Home, Thread } from "../domain/thread.js";
import type { ThreadChange } from "../domain/thread-changes.js";

/** The Thread after a change, with its event, or undefined when nothing changed. */
export interface ThreadUpdate<Event extends DomainEvent> {
  readonly thread: Thread;
  readonly event: Event | undefined;
}

/** Where Threads are kept, each with The Office's log of its messages. */
export abstract class ThreadRepository {
  abstract add(thread: Thread): Promise<void>;

  abstract find(id: string): Promise<Thread | undefined>;

  /** The home's Threads, the newest started first. */
  abstract listIn(home: Home): Promise<readonly Thread[]>;

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
}
