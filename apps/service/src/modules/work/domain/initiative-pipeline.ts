import type { Initiative } from "./initiative.js";
import { initiativeEditProblems } from "./initiative-edit.js";
import { isPublishingTask, type Task } from "./task.js";
import { NOT_STARTED_STATES } from "./task-states.js";
import {
  missingCommands,
  missingCommandsWords,
  type PipelineCommands,
} from "./pipeline-commands.js";

/** A Project an Initiative spans, as far as its Pipeline's commands are judged. */
export interface InitiativeProject {
  readonly name: string;
  readonly commands: readonly { readonly key: string }[];
}

/**
 * Why the Initiative can't follow the Pipeline: a command it runs that one of the Projects it
 * spans lacks, named for each Project (spec 2.3). None when every Project has them all.
 */
export function initiativePipelineProblems(
  pipeline: PipelineCommands,
  projects: readonly InitiativeProject[],
): string[] {
  return projects.flatMap((project) => {
    const missing = missingCommands(pipeline, project);
    return missing.length > 0 ? [missingCommandsWords(pipeline.name, missing, project.name)] : [];
  });
}

/**
 * Every reason applying the CTO's Proposal of another Pipeline would be refused now, in words the
 * CTO acts on: what Confirm fixed, a Pipeline it follows already, the Pipeline having started in
 * one of its Publishing Tasks (`tasks`, the Initiative's), then the commands of each Project it
 * spans. Whether the library has the Pipeline is the caller's to judge.
 */
export function initiativePipelineChangeProblems(
  initiative: Initiative,
  pipelineId: string | null,
  pipeline: PipelineCommands | undefined,
  projects: readonly InitiativeProject[],
  tasks: readonly Task[],
): string[] {
  const judged = initiativeEditProblems(
    initiative,
    { kind: "pipeline", pipelineId },
    [],
    pipeline?.name,
  );
  if (judged.length > 0) return judged;
  const started = startedPublishingTask(tasks);
  if (started)
    return [`The Initiative's Pipeline started in ${started.title}, so it can't change.`];
  if (pipeline === undefined) return judged;
  return initiativePipelineProblems(pipeline, projects);
}

/**
 * The Publishing Task the Initiative's Pipeline started in ("the Pipeline starts", spec 2.1), the
 * first of `tasks` that has; undefined while none has. A Dropped one no longer counts: the
 * Publishing Task added after it is added on the Pipeline as it then stands.
 */
export function startedPublishingTask(tasks: readonly Task[]): Task | undefined {
  return tasks.find(
    (task) =>
      isPublishingTask(task) &&
      task.state !== "dropped" &&
      !NOT_STARTED_STATES.includes(task.state),
  );
}
