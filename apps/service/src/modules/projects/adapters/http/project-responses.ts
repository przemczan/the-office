import type {
  ProjectEngine as ProjectEngineResponse,
  ProjectEnvironment as ProjectEnvironmentResponse,
  Project as ProjectResponse,
  ProjectImageVersions as ProjectImageVersionsResponse,
} from "@the-office/contracts";
import { defaultPipelineOfKind } from "../../domain/kind-default-pipeline.js";
import type { Project, ProjectEngine } from "../../domain/project.js";
import { featureStatesOf } from "../../domain/project-features.js";
import type { ProjectImageVersions } from "../../domain/project-image.js";
import { shownEnvironment, type ProjectEnvironment } from "../../domain/project-environment.js";

function toImageVersionsResponse({
  light,
  dark,
}: ProjectImageVersions): ProjectImageVersionsResponse {
  return { light: light && { ...light }, dark: dark && { ...dark } };
}

/** `codeHost` is the name of the code host holding the base branch's remote, null when none does. */
export function toProjectResponse(project: Project, codeHost: string | null): ProjectResponse {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    repositoryUrl: project.repositoryUrl,
    baseBranch: project.baseBranch,
    mark: { label: project.mark.label, colour: project.mark.colour },
    icon: toImageVersionsResponse(project.icon),
    logo: toImageVersionsResponse(project.logo),
    installCommand: project.installCommand,
    commands: project.commands.map(({ key, name, kind, commandLine, rerunCommandLine }) => ({
      key,
      name,
      kind,
      commandLine,
      rerunCommandLine,
    })),
    installInputs: [...project.installInputs],
    publishingMode: project.publishingMode,
    beforePublishingCommand: project.beforePublishingCommand,
    afterPublishingCommand: project.afterPublishingCommand,
    deleteMergedBranches: project.deleteMergedBranches,
    defaultPipeline: project.defaultPipeline,
    environment: toEnvironmentResponse(project.environment),
    useProjectSkills: project.useProjectSkills,
    projectSkillsOff: [...project.projectSkillsOff],
    engine: toEngineResponse(project.engine),
    runEnvironment: project.runEnvironment,
    projectLimit: project.projectLimit,
    addedAt: project.addedAt.toISOString(),
    codeHost,
    kindDefaultPipelines: { ...project.kindDefaultPipelines },
    defaultPipelineOfKind: defaultPipelineOfKind(project),
    issueSettings: {
      autoImportLabel: project.issueSettings.autoImportLabel,
      closeOnDone: project.issueSettings.closeOnDone,
      commentOnStartAndDone: project.issueSettings.commentOnStartAndDone,
      closeOnDrop: project.issueSettings.closeOnDrop,
    },
    features: { ...featureStatesOf(project) },
  };
}

/** The environment as the web sees it: a Secret variable's value never leaves the service. */
export function toEnvironmentResponse(environment: ProjectEnvironment): ProjectEnvironmentResponse {
  const shown = shownEnvironment(environment);
  return {
    set: shown.set.map((variable) =>
      variable.secret
        ? { name: variable.name, secret: true, valueSet: variable.valueSet }
        : { name: variable.name, secret: false, value: variable.value },
    ),
    unset: [...shown.unset],
    prependPath: [...shown.prependPath],
  };
}

function toEngineResponse({
  default: projectDefault,
  force,
  people,
  standIns,
}: ProjectEngine): ProjectEngineResponse {
  return {
    default: projectDefault && { ...projectDefault },
    force: force && { ...force },
    people: people.map(({ roleKey, engineSettings }) => ({
      roleKey,
      engineSettings: Object.fromEntries(
        Object.entries(engineSettings).map(([type, setting]) => [type, { ...setting }]),
      ),
    })),
    standIns: { useOwnList: standIns.useOwnList, engineIds: [...standIns.engineIds] },
  };
}
