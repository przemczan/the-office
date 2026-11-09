import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { CpuLimit } from "./run-environment.js";

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

/** Settings saved a new CPU limit; each run environment's next start reads it. */
export class RunEnvironmentCpuLimitChanged extends DomainEvent {
  constructor(readonly cpuLimit: CpuLimit) {
    super();
  }
}
