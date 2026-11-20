import { pipelineProblem, type StageProblem } from "./pipeline.js";

/** A Pipeline's name taken already, with the Project whose Pipeline it is; none for an office-wide one. */
export interface TakenName {
  readonly name: string;
  readonly projectName: string | undefined;
}

/**
 * Why a Pipeline can't take the name (spec §2.3): it needs one, and none of `taken` may have it in
 * any case. An office-wide Pipeline's name is weighed against every Pipeline, a Project Pipeline's
 * against the office-wide ones and its own Project's; a refusal for a Project Pipeline names its
 * Project.
 */
export function pipelineNameProblems(name: string, taken: readonly TakenName[]): StageProblem[] {
  const trimmed = name.trim();
  if (trimmed === "") return [pipelineProblem("Give the Pipeline a name.")];
  const named = comparableName(trimmed);
  const holder = taken.find((other) => comparableName(other.name) === named);
  if (!holder) return [];
  return holder.projectName === undefined
    ? [pipelineProblem(`Another Pipeline is named "${trimmed}".`)]
    : [pipelineProblem(`${holder.projectName} has a Pipeline of its own named "${trimmed}".`)];
}

/** Names compare trimmed and in any case, as the tables' unique indexes do. */
export function comparableName(name: string): string {
  return name.trim().toLowerCase();
}
