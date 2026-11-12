/**
 * A Pipeline's name and the Project commands, by key, its Stages run (spec §2.3); a Project
 * Pipeline's are its built Stages', and it names its Project and why it is Broken.
 */
export interface PipelineCommands {
  readonly name: string;
  readonly keys: readonly string[];
  /** The Project whose Project Pipeline it is; undefined for an office-wide one. */
  readonly projectId?: string;
  /** Each reason it is Broken; empty when it isn't. */
  readonly broken: readonly string[];
}

/**
 * Why the Project can't take the Pipeline as its default, before its commands are weighed (spec
 * §2.3, "Project Pipelines"): another Project's Project Pipeline, or a Broken one of its own. A new
 * Project (no id yet) takes an office-wide one only. `ownerName` names the Project a Project
 * Pipeline belongs to.
 */
export function defaultPipelineOwnerProblems(
  pipeline: PipelineCommands,
  projectId: string | undefined,
  ownerName: string,
): string[] {
  if (pipeline.projectId === undefined) return [];
  if (projectId === undefined) {
    return [
      `${pipeline.name} is a Project Pipeline of ${ownerName}; a new Project's default Pipeline is an office-wide one.`,
    ];
  }
  if (pipeline.projectId !== projectId) {
    return [
      `${pipeline.name} is a Project Pipeline of ${ownerName}: only ${ownerName}'s Tasks and default can follow it.`,
    ];
  }
  if (pipeline.broken.length === 0) return [];
  return [
    `${pipeline.name} is Broken: ${pipeline.broken.join(" ")} A Broken Pipeline can't be the default: fix its Stage changes in ${ownerName}'s Pipelines first, or choose another default Pipeline.`,
  ];
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
