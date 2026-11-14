import type { Initiative } from "./initiative.js";
import { initiativeEditProblems } from "./initiative-edit.js";
import { isPublishingTask, type Task } from "./task.js";
import { NOT_STARTED_STATES } from "./task-states.js";
import {
  taskPipelineProblems,
  type TaskPipelineChoice,
  type TaskPipelineProject,
} from "./pipeline-commands.js";

/**
 * Every reason applying a Proposal of whoever shapes Initiatives of another Pipeline in one Project would be refused now,
 * in words whoever shapes Initiatives acts on: what Confirm fixed, a Pipeline the Project follows already, the
 * Pipeline having started in that Project's Publishing Task (`tasks`, the Initiative's), then
 * whether the Project can follow the Pipeline, as a Task of it could (`choice`, undefined for None).
 */
export function initiativePipelineChangeProblems(
  initiative: Initiative,
  project: TaskPipelineProject,
  choice: TaskPipelineChoice | undefined,
  tasks: readonly Task[],
): string[] {
  const judged = initiativeEditProblems(
    initiative,
    { kind: "pipeline", projectId: project.id, pipelineId: choice?.pipelineId ?? null },
    [],
    { project: project.name, pipeline: choice?.pipeline?.name },
  );
  if (judged.length > 0) return judged;
  const started = startedPublishingTask(tasks, project.id);
  if (started) {
    return [
      `The Initiative's Pipeline in ${project.name} started in ${started.title}, so it can't change.`,
    ];
  }
  return choice === undefined ? [] : taskPipelineProblems(choice, project);
}

/**
 * The Publishing Task the Initiative's Pipeline started in ("the Pipeline starts", spec 2.1), the
 * first of `tasks` that has, in `projectId` when given; undefined while none has. A Dropped one no
 * longer counts: the Publishing Task added after it is added on the Pipeline as it then stands.
 */
export function startedPublishingTask(
  tasks: readonly Task[],
  projectId?: string,
): Task | undefined {
  return tasks.find(
    (task) =>
      isPublishingTask(task) &&
      (projectId === undefined || task.projectId === projectId) &&
      task.state !== "dropped" &&
      !NOT_STARTED_STATES.includes(task.state),
  );
}
