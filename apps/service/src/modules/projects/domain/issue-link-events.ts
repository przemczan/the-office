import { DomainEvent } from "../../../platform/events/domain-event.js";

/** Issues of the Project were imported as Tasks, by hand or by the auto-import. */
export class IssuesImported extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly imported: readonly { readonly number: number; readonly taskId: string }[],
  ) {
    super();
  }
}

/**
 * What a Task's issue record shows changed: its issue closed or opened again on the code host, or
 * a write-back to it failed or went through after failing.
 */
export class IssueLinkChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly taskId: string,
  ) {
    super();
  }
}
