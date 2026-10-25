import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Project, ProjectCommandKey, PublishingMode } from "./project.js";

export class ProjectAdded extends DomainEvent {
  constructor(readonly project: Project) {
    super(project.addedAt);
  }
}

/** Tasks already running keep the command line they started with. */
export class ProjectCommandChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly key: ProjectCommandKey,
    readonly commandLine: string,
  ) {
    super();
  }
}

/** A worktree installs again when its install inputs no longer match its last install. */
export class ProjectInstallInputsChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly installInputs: readonly string[],
  ) {
    super();
  }
}

export class ProjectPublishingModeChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly publishingMode: PublishingMode,
  ) {
    super();
  }
}

export class ProjectDefaultPipelineChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly defaultPipeline: string,
  ) {
    super();
  }
}
