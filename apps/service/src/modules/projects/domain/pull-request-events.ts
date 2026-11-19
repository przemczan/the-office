import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { MergeMethod } from "./merge-method.js";

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

/** Who ended a pull request: a user, from Work › Pull requests, or someone on its code host. */
export type PullRequestEndedBy =
  | { readonly kind: "user"; readonly userId: string; readonly name: string }
  | { readonly kind: "code-host"; readonly name: string };

/** Ended directly on the code host, which `name` names ("GitHub"). */
export function onTheCodeHost(name: string): PullRequestEndedBy {
  return { kind: "code-host", name };
}

/**
 * A pull request The Office opened was merged, from Work › Pull requests or on its code host.
 * Published once per end: the row is ended by a conditional update, whoever saw it first.
 */
export class PullRequestMerged extends DomainEvent {
  constructor(
    readonly pullRequestId: string,
    readonly projectId: string,
    readonly taskId: string,
    readonly number: number,
    readonly url: string,
    /** Undefined when it was merged on the code host. */
    readonly method: MergeMethod | undefined,
    readonly by: PullRequestEndedBy,
    at: Date,
  ) {
    super(at);
  }
}

/** A pull request The Office opened was closed without merging, once per end like PullRequestMerged. */
export class PullRequestClosed extends DomainEvent {
  constructor(
    readonly pullRequestId: string,
    readonly projectId: string,
    readonly taskId: string,
    readonly number: number,
    readonly url: string,
    readonly by: PullRequestEndedBy,
    at: Date,
  ) {
    super(at);
  }
}

/** A pull request The Office had seen end shows up open again on its code host. */
export class PullRequestReopened extends DomainEvent {
  constructor(
    readonly pullRequestId: string,
    readonly projectId: string,
    readonly taskId: string,
    readonly number: number,
    readonly url: string,
    at: Date,
  ) {
    super(at);
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
