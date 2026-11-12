import type { ProjectPipeline } from "@the-office/contracts";
import type {
  ProjectPipelineFields,
  ProposedProjectPipelineChange,
} from "../../../conversations/index.js";

/** A Proposal of a new Project Pipeline of the Project, with `to` as proposed. */
export function aNewOne(
  projectId: string,
  to: ProjectPipelineFields,
): ProposedProjectPipelineChange {
  return { kind: "project-pipeline", projectId, pipelineId: null, from: null, to };
}

/** A Proposal of a change to the Project Pipeline as read now, with `fields` as proposed. */
export function aChangeTo(
  projectPipeline: ProjectPipeline,
  fields: Partial<ProjectPipelineFields>,
): ProposedProjectPipelineChange {
  const from = fieldsOf(projectPipeline);
  return {
    kind: "project-pipeline",
    projectId: projectPipeline.projectId,
    pipelineId: projectPipeline.id,
    from,
    to: { ...from, ...fields },
  };
}

/** The Project Pipeline's fields as a Proposal of it carries them. */
export function fieldsOf({
  name,
  description,
  basePipeline,
  stageChanges,
}: ProjectPipeline): ProjectPipelineFields {
  return { name, description, basePipelineId: basePipeline.id, stageChanges };
}
