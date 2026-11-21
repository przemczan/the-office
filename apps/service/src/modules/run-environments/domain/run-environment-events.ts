import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { RunEnvironmentOptions } from "./run-environment.js";

/** A Task's run environment was started for the first time: its compose project is up. */
export class RunEnvironmentCreated extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly projectId: string,
    readonly image: string,
  ) {
    super();
  }
}

/**
 * A Task's run environment is up and its checks can run: after every start, the first, one after
 * an idle stop and one on a replaced worktree alike. Published inside the Task's step, before the
 * check that started it runs.
 */
export class RunEnvironmentStarted extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly projectId: string,
  ) {
    super();
  }
}

/**
 * A Task's run environment stopped, or The Office no longer counts it running: an idle stop, a
 * stop before a start on a replaced worktree, a stop after a check couldn't run, the startup
 * sweep's stop, or its removal while it ran.
 */
export class RunEnvironmentStopped extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** A Task's run environment, its containers, network, volumes and files, was removed. */
export class RunEnvironmentRemoved extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** A Project's image was built for a key it had no image for (spec §5.5, "Image cache"). */
export class RunEnvironmentImageBuilt extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly image: string,
  ) {
    super();
  }
}

/**
 * Settings saved the run environments' Office limits; each run environment's next start reads
 * them, and a higher Run environments at once admits the waiting at once.
 */
export class RunEnvironmentSettingsChanged extends DomainEvent {
  constructor(readonly options: RunEnvironmentOptions) {
    super();
  }
}
