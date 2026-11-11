/** A library Pipeline's name and the Project commands, by key, its Stages run (spec §2.3). */
export interface PipelineCommands {
  readonly name: string;
  readonly keys: readonly string[];
}

/**
 * Why a Project with these commands can't take the Pipeline as its default: a key it names that the
 * Project lacks. Keys alone count: a command left blank passes, and fails as could-not-run when it
 * runs. A Stage is never skipped instead.
 */
export function missingPipelineCommandsProblems(
  pipeline: PipelineCommands,
  commands: readonly { readonly key: string }[],
  projectName: string,
): string[] {
  const keys = new Set(commands.map(({ key }) => key));
  const missing = pipeline.keys.filter((key) => !keys.has(key));
  if (missing.length === 0) return [];
  const project = projectName || "the Project";
  if (missing.length === 1) {
    return [
      `The Pipeline ${pipeline.name} runs ${missing[0]}, which ${project} has no command for. Add it to the Project's commands, or choose another default Pipeline.`,
    ];
  }
  return [
    `The Pipeline ${pipeline.name} runs ${listed(missing)}, which ${project} has no commands for. Add them to the Project's commands, or choose another default Pipeline.`,
  ];
}

/** Why the command can't be removed: the Project's default Pipeline runs it. */
export function namedByDefaultPipelineProblems(
  key: string,
  defaultPipeline: PipelineCommands | undefined,
): string[] {
  if (!defaultPipeline?.keys.includes(key)) return [];
  return [
    `${defaultPipeline.name}, this Project's default Pipeline, runs ${key}; choose another default first.`,
  ];
}

function listed(keys: readonly string[]): string {
  return `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`;
}
