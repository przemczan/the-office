import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { failAnswer } from "../domain/thread-changes.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/**
 * Threads left answering when The Office last stopped: no session answers them any more, so each
 * waits for the user again, with why in its log. Run as the service starts, before it serves.
 */
@Injectable()
export class InterruptedAnswers {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly events: EventBus,
  ) {}

  async recover(): Promise<void> {
    for (const thread of await this.repository.answering()) {
      const { event } = await this.repository.update(thread.id, (latest) =>
        latest.state === "answering"
          ? failAnswer(latest, "The Office stopped while this was being answered.", new Date())
          : undefined,
      );
      if (event) await this.events.publish(event);
    }
  }
}
