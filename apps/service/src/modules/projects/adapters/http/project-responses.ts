import type {
  ProjectEnvironment as ProjectEnvironmentResponse,
  Project as ProjectResponse,
  ProjectImageVersions as ProjectImageVersionsResponse,
} from "@the-office/contracts";
import type { Project } from "../../domain/project.js";
import type { ProjectImageVersions } from "../../domain/project-image.js";
import { shownEnvironment, type ProjectEnvironment } from "../../domain/project-environment.js";

function toImageVersionsResponse({
  light,
  dark,
}: ProjectImageVersions): ProjectImageVersionsResponse {
  return { light: light && { ...light }, dark: dark && { ...dark } };
}

export function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    repositoryUrl: project.repositoryUrl,
    baseBranch: project.baseBranch,
    mark: { label: project.mark.label, colour: project.mark.colour },
    icon: toImageVersionsResponse(project.icon),
    logo: toImageVersionsResponse(project.logo),
    commands: { ...project.commands },
    installInputs: [...project.installInputs],
    publishingMode: project.publishingMode,
    defaultPipeline: project.defaultPipeline,
    environment: toEnvironmentResponse(project.environment),
    useProjectSkills: project.useProjectSkills,
    projectSkillsOff: [...project.projectSkillsOff],
    projectDefault: project.projectDefault && { ...project.projectDefault },
    useForEveryRole: project.useForEveryRole,
    roleOverrides: project.roleOverrides.map(({ roleKey, engineId, model }) => ({
      roleKey,
      engineId,
      model,
    })),
    runEnvironment: project.runEnvironment,
    projectLimit: project.projectLimit,
    addedAt: project.addedAt.toISOString(),
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
