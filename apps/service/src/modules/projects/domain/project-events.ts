import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { EngineModel } from "../../engine/index.js";
import type { Project, ProjectCommandKey, ProjectMark, PublishingMode } from "./project.js";
import type { ProjectEnvironment } from "./project-environment.js";
import type { ProjectImage, ProjectImageKey } from "./project-image.js";

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

/** Saved by an environment check that passed with it. */
export class ProjectEnvironmentChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly environment: ProjectEnvironment,
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

export class ProjectMarkChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly mark: ProjectMark,
  ) {
    super();
  }
}

/** `image` is null when the Project's Icon or Logo was removed. */
export class ProjectImageChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly key: ProjectImageKey,
    readonly image: ProjectImage | null,
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

/** Sessions started from now on run on the new Project default; null when the Project has none. */
export class ProjectDefaultChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly projectDefault: EngineModel | null,
  ) {
    super();
  }
}

export class ProjectUseForEveryRoleChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly useForEveryRole: boolean,
  ) {
    super();
  }
}

/** The Role's override in the Project; null when it was removed. */
export class ProjectRoleOverrideChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly roleKey: string,
    readonly roleOverride: EngineModel | null,
  ) {
    super();
  }
}

/** Sessions started from now on get the repository's own skills, or have them turned off. */
export class ProjectUseProjectSkillsChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly useProjectSkills: boolean,
  ) {
    super();
  }
}

/** Sessions started from now on get the repository's skill of this key, or start without it. */
export class ProjectSkillUseChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly key: string,
    readonly use: boolean,
  ) {
    super();
  }
}
