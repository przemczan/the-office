import type { Initiative } from "./initiative.js";
import { initiativeEditProblems } from "./initiative-edit.js";
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
 * CTO acts on: what Confirm fixed, a Pipeline it follows already, then the commands of each
 * Project it spans. Whether the library has the Pipeline is the caller's to judge.
 */
export function initiativePipelineChangeProblems(
  initiative: Initiative,
  pipelineId: string | null,
  pipeline: PipelineCommands | undefined,
  projects: readonly InitiativeProject[],
): string[] {
  const judged = initiativeEditProblems(
    initiative,
    { kind: "pipeline", pipelineId },
    [],
    pipeline?.name,
  );
  if (judged.length > 0 || pipeline === undefined) return judged;
  return initiativePipelineProblems(pipeline, projects);
}
