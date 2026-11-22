import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { EngineModel } from "../../engine/index.js";
import type {
  Project,
  ProjectCommand,
  ProjectMark,
  PublishingMode,
  RunEnvironmentSetting,
} from "./project.js";
import type { IssueSettings } from "./issue-settings.js";
import type { ProjectFeatureStates } from "./project-features.js";
import type { TaskKind } from "./kind-default-pipeline.js";
import type { ShownEnvironment } from "./project-environment.js";
import type { ProjectImage, ProjectImageKey, ProjectImagePalette } from "./project-image.js";

export class ProjectAdded extends DomainEvent {
  constructor(readonly project: Project) {
    super(project.addedAt);
  }
}

/** A worktree installs again when the install command differs from its last install's. */
export class ProjectInstallCommandChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly commandLine: string,
  ) {
    super();
  }
}

/** Blank when cleared; a Publish already running keeps the line it read. */
export class ProjectBeforePublishingCommandChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly commandLine: string,
  ) {
    super();
  }
}

/** Blank when cleared; a Publish already running keeps the line it read. */
export class ProjectAfterPublishingCommandChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly commandLine: string,
  ) {
    super();
  }
}

export class ProjectCommandAdded extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly command: ProjectCommand,
  ) {
    super();
  }
}

/** Its name, kind or command line; Tasks already running keep the command line they started with. */
export class ProjectCommandChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly command: ProjectCommand,
  ) {
    super();
  }
}

export class ProjectCommandRemoved extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly key: string,
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

/** Saved by an environment check that passed with it; its Secret variables by their names alone. */
export class ProjectEnvironmentChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly environment: ShownEnvironment,
  ) {
    super();
  }
}

/** Delete branches once merged turned On or Off; On has Work sweep the Project's leftovers. */
export class ProjectDeleteMergedBranchesChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly on: boolean,
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

/** The Run environment setting, or why a set-up Task's Done left it as it was. */
export class ProjectRunEnvironmentChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly runEnvironment: RunEnvironmentSetting,
    readonly setUpProblems: readonly string[],
  ) {
    super();
  }
}

/** A raised limit may start the Project's queued Tasks; a lowered one stops no started Task. */
export class ProjectLimitChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly projectLimit: number,
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

/** `image` is null when that version of the Project's Icon or Logo was removed. */
export class ProjectImageChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly key: ProjectImageKey,
    readonly palette: ProjectImagePalette,
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

/** A Kind's own default Pipeline in the Project; null follows the Project's default Pipeline. */
export class ProjectKindDefaultPipelineChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly kind: TaskKind,
    readonly pipelineId: string | null,
  ) {
    super();
  }
}

/** The Project's GitHub issue switches changed. */
export class ProjectIssueSettingsChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly issueSettings: IssueSettings,
  ) {
    super();
  }
}

/** The Project's feature switches changed; `features` is every feature as it reads now. */
export class ProjectFeaturesChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly features: ProjectFeatureStates,
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

/** The Project's test targets changed, on its page or by an applied Proposal; read them anew. */
export class ProjectTestTargetsChanged extends DomainEvent {
  constructor(readonly projectId: string) {
    super();
  }
}

/**
 * The Project's Actions changed, on its page or by an applied Proposal; read them anew.
 * `removedKeys` names the Actions removed, whose runs go with them.
 */
export class ProjectActionsChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly removedKeys: readonly string[],
  ) {
    super();
  }
}
