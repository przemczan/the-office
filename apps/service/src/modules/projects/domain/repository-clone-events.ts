import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { CloneProgress, RepositoryClone } from "./repository-clone.js";

export class RepositoryCloneStarted extends DomainEvent {
  constructor(readonly clone: RepositoryClone) {
    super(clone.startedAt);
  }
}

/** git moved on to another phase or percentage of a running clone. */
export class RepositoryCloneProgressed extends DomainEvent {
  constructor(
    readonly cloneId: string,
    readonly progress: CloneProgress,
  ) {
    super();
  }
}

/** The clone is complete, with the remote's branches, or failed and says why. */
export class RepositoryCloneFinished extends DomainEvent {
  constructor(readonly clone: RepositoryClone) {
    super(clone.finishedAt);
  }
}
