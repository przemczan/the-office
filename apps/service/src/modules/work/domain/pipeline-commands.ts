/**
 * A Pipeline's name and the Project commands, by key, its Stages run (spec §2.3), and whether one
 * of its Stages is a Gate: one without publishes without the user's review. A Project Pipeline's
 * are its built Stages', and it names its Project and why it is Broken.
 */
export interface PipelineCommands {
  readonly name: string;
  readonly keys: readonly string[];
  readonly hasGate: boolean;
  /** The Project whose Project Pipeline it is; undefined for an office-wide one. */
  readonly projectId?: string;
  /** Each reason it is Broken; empty when it isn't. */
  readonly broken: readonly string[];
}

/** The Pipeline chosen for a Task, as `taskPipelineProblems` weighs it. */
export interface TaskPipelineChoice {
  readonly pipelineId: string;
  /** Undefined for an id neither the library nor a Project has. */
  readonly pipeline: PipelineCommands | undefined;
  /** The name of the Project a Project Pipeline belongs to, when that is another Project. */
  readonly ownerName?: string;
  /** What the Task's Project can choose, by id: its own Pipelines, then the office-wide ones. */
  readonly choices: readonly string[];
}

/** The Task's Project, as far as its Pipeline goes. */
export interface TaskPipelineProject {
  readonly id: string;
  readonly name: string;
  readonly commands: readonly { readonly key: string }[];
}

/**
 * Why a Task of the Project can't follow the Pipeline (spec §2.3, "Project Pipelines" and "A
 * Broken Project Pipeline"), the first that applies: one neither the library nor the Project has,
 * another Project's Project Pipeline, a Broken one, or one whose built Stages run a command the
 * Project lacks. Empty when it can.
 */
export function taskPipelineProblems(
  { pipelineId, pipeline, ownerName, choices }: TaskPipelineChoice,
  project: TaskPipelineProject,
): string[] {
  if (!pipeline) {
    return [
      `There is no Pipeline "${pipelineId}". ${project.name} can choose ${choices.join(", ")}.`,
    ];
  }
  if (pipeline.projectId !== undefined && pipeline.projectId !== project.id) {
    const owner = ownerName ?? pipeline.projectId;
    return [
      `${pipeline.name} is a Project Pipeline of ${owner}: only ${owner}'s Tasks can follow it.`,
    ];
  }
  if (pipeline.broken.length > 0)
    return [brokenPipelineWords(pipeline.name, pipeline.broken, project.name)];
  const missing = missingCommands(pipeline, project);
  return missing.length > 0 ? [missingCommandsWords(pipeline.name, missing, project.name)] : [];
}

/** Why a Task can't choose a Broken Project Pipeline, with each reason and where it is fixed. */
export function brokenPipelineWords(
  pipelineName: string,
  reasons: readonly string[],
  projectName: string,
): string {
  return `${pipelineName} is Broken: ${reasons.join(" ")} Fix its Stage changes in ${projectName}'s Pipelines, or choose another Pipeline.`;
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
