import type { TaskPipelineChoice } from "../domain/pipeline-commands.js";
import type { KnownPipelines } from "../ports/known-pipelines.js";
import type { KnownProjects } from "../ports/known-projects.js";

/**
 * The Pipeline chosen for work in the Project, as `taskPipelineProblems` weighs it: a Task's own,
 * or an Initiative's Pipeline in that Project. The owner's name only for another Project's Project
 * Pipeline, and the choices only when the id is unknown, as they are only named then.
 */
export async function pipelineChoiceIn(
  projectId: string,
  pipelineId: string,
  pipelines: KnownPipelines,
  projects: KnownProjects,
): Promise<TaskPipelineChoice> {
  const pipeline = await pipelines.commandsNamedBy(pipelineId);
  const ownerName =
    pipeline?.projectId === undefined || pipeline.projectId === projectId
      ? undefined
      : (await projects.find(pipeline.projectId))?.name;
  const choices = pipeline
    ? []
    : (await pipelines.listFor(projectId))
        .filter(({ broken = [] }) => broken.length === 0)
        .map(({ id }) => id);
  return { pipelineId, pipeline, ownerName, choices };
}
