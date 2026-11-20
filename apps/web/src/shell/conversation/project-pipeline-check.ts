import type {
  ProjectPipelineCheckRequest,
  ProjectPipelineFields,
  ProposedChange,
} from "@the-office/contracts";

export type ProposedProjectPipeline = Extract<ProposedChange, { kind: "project-pipeline" }>;

/** The service's check of the Project Pipeline with these fields, which builds its Stages. */
export function checkRequest(
  change: ProposedProjectPipeline,
  fields: ProjectPipelineFields,
): ProjectPipelineCheckRequest {
  return {
    ...fields,
    projectId: change.projectId,
    ...(change.pipelineId === null ? {} : { projectPipelineId: change.pipelineId }),
  };
}
