import { DomainEvent } from "../../../platform/events/domain-event.js";

/** Publish opened a pull request, or found the one open for the Task's branch, and recorded it. */
export class PullRequestOpened extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly taskId: string,
    readonly number: number,
    readonly url: string,
    openedAt: Date,
  ) {
    super(openedAt);
  }
}

/**
 * A refresh of the pull requests changed what the list shows: one adopted, a status read, one
 * merged or closed, one gone stale or fresh again, or a Project's problem raised or cleared.
 */
export class PullRequestsChecked extends DomainEvent {
  constructor(
    /** The Projects whose pull requests or problem changed. */
    readonly projectIds: readonly string[],
    checkedAt: Date,
  ) {
    super(checkedAt);
  }
}
