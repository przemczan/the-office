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
