/**
 * A library Pipeline's name and the Project commands, by key, its Stages run (spec §2.3), and
 * whether one of its Stages is a Gate: one without publishes without the user's review.
 */
export interface PipelineCommands {
  readonly name: string;
  readonly keys: readonly string[];
  readonly hasGate: boolean;
}

/**
 * The keys the Pipeline runs that the Project has no command by. Keys alone count: a command left
 * blank passes, and fails as could-not-run when it runs.
 */
export function missingCommands(
  pipeline: PipelineCommands,
  project: { readonly commands: readonly { readonly key: string }[] },
): string[] {
  const keys = new Set(project.commands.map(({ key }) => key));
  return pipeline.keys.filter((key) => !keys.has(key));
}

/**
 * Why a Task of the Project can't follow the Pipeline, naming each missing command: a Stage is
 * never skipped instead (spec §2.3).
 */
export function missingCommandsWords(
  pipelineName: string,
  missing: readonly string[],
  projectName: string,
): string {
  const [only] = missing;
  if (missing.length === 1 && only !== undefined) {
    return `The Pipeline ${pipelineName} runs ${only}, which ${projectName} has no command for. Add it on the Project page, or choose another Pipeline.`;
  }
  const listed = `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`;
  return `The Pipeline ${pipelineName} runs ${listed}, which ${projectName} has no commands for. Add them on the Project page, or choose another Pipeline.`;
}
