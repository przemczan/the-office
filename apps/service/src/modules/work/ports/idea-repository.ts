import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Attachment } from "../domain/attachment.js";
import type { AttachmentChange } from "../domain/attachment-changes.js";
import type { AttachmentMoved } from "../domain/attachment-events.js";
import type { Idea } from "../domain/idea.js";
import type { IdeaChange, Shaping } from "../domain/idea-changes.js";

/** The Idea after an update, with the change's event, or undefined when nothing changed. */
export interface IdeaUpdate<Event extends DomainEvent> {
  readonly idea: Idea;
  readonly event: Event | undefined;
}

/** An Idea shaped into a Task, with its Attachments moved to the Task. */
export interface ShapedIdea extends Shaping {
  readonly moves: readonly AttachmentChange<AttachmentMoved>[];
}

/** Where Ideas are kept. */
export abstract class IdeaRepository {
  abstract add(idea: Idea): Promise<void>;

  abstract find(id: string): Promise<Idea | undefined>;

  /** Every Idea, the newest captured first. */
  abstract list(): Promise<readonly Idea[]>;

  /**
   * Applies `change` to the Idea as stored, holding it against other changes until the result is
   * saved. Saves nothing when `change` returns undefined; throws IdeaNotFound when there is no
   * such Idea.
   */
  abstract update<Event extends DomainEvent>(
    id: string,
    change: (idea: Idea) => IdeaChange<Event> | undefined,
  ): Promise<IdeaUpdate<Event>>;

  /**
   * Saves the Idea, the Task and the moved Attachments `shape` makes, all or none, from the Idea
   * and its Attachments as stored and every key on the board, holding the Idea and the board's
   * manual order meanwhile. Throws IdeaNotFound when there is no such Idea.
   */
  abstract shape(
    id: string,
    shape: (
      idea: Idea,
      attachments: readonly Attachment[],
      takenOrders: readonly string[],
    ) => ShapedIdea,
  ): Promise<ShapedIdea>;
}
