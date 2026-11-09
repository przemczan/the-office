import type { Project as ProjectResponse } from "@the-office/contracts";
import type { Project } from "../../domain/project.js";

export function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    repositoryUrl: project.repositoryUrl,
    baseBranch: project.baseBranch,
    mark: { label: project.mark.label, colour: project.mark.colour },
    icon: project.icon && { ...project.icon },
    logo: project.logo && { ...project.logo },
    commands: { ...project.commands },
    installInputs: [...project.installInputs],
    publishingMode: project.publishingMode,
    defaultPipeline: project.defaultPipeline,
    environment: {
      set: project.environment.set.map(({ name, value }) => ({ name, value })),
      unset: [...project.environment.unset],
      prependPath: [...project.environment.prependPath],
    },
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
