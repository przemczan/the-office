import { ONBOARD_PIPELINE, SET_UP_RUN_ENVIRONMENT_PIPELINE } from "./built-in-pipelines.js";
import { asFlow, pipelineOrder } from "./flow.js";
import { pipelineProblem, stageProblems, type Pipeline, type StageProblem } from "./pipeline.js";
import { PipelineAdded, PipelineSaved } from "./pipeline-library-events.js";
import { comparableName, pipelineNameProblems, type TakenName } from "./pipeline-names.js";
import type { ProjectPipeline } from "./project-pipeline.js";
import { sameAsKept, type Stage } from "./stage.js";
import { commandsWords, missingCommandsOnStages } from "./stage-commands.js";
import { staffingProblems, type RoleFilling } from "./stage-staffing.js";

/** What the user writes of a library Pipeline in the library editor; its id stays. */
export interface PipelineEdit {
  readonly name: string;
  readonly description: string;
  readonly stages: readonly Stage[];
}

/** A Task as the library weighs who uses a Pipeline. */
export interface TaskOnPipeline {
  readonly state: string;
  readonly projectId: string;
  /** Undefined while the Task has none: it uses no Pipeline. */
  readonly pipelineId: string | undefined;
}

/** A Project as the library weighs who names a Pipeline as their default, and what it can run. */
export interface ProjectOnPipeline {
  readonly id: string;
  readonly name: string;
  readonly defaultPipeline: string;
  readonly commands: readonly { readonly key: string }[];
}

/**
 * An Initiative as the library weighs who uses a Pipeline: one that names it as its own in one
 * Project it spans, so an Initiative on it in two Projects comes twice.
 */
export interface InitiativeOnPipeline {
  readonly name: string;
  readonly state: string;
  readonly projectId: string;
  readonly pipelineId: string;
  /** Whether its Pipeline started in that Project's Publishing Task, which walks its own Stages. */
  readonly pipelineStarted: boolean;
}

/** A Project Pipeline built from an office-wide Pipeline, with its Project's name. */
export interface ProjectPipelineOnPipeline {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
}

/** Who uses a library Pipeline: what removing it would leave without one, and what saving changes. */
export interface PipelineUse {
  readonly defaultFor: readonly { readonly projectId: string; readonly name: string }[];
  readonly notStarted: number;
  readonly running: number;
  /** The names of the shaping and active Initiatives that name it. */
  readonly initiatives: readonly string[];
  /** The Project Pipelines built from it, which its edits reach. */
  readonly projectPipelines: readonly ProjectPipelineOnPipeline[];
}

/** States of a Task that hasn't started: it reads its library Pipeline when it does. */
const NOT_STARTED_STATES: readonly string[] = ["shaping", "backlog", "planning", "ready"];

/** States of a started Task still at work, on the copy of the Stages it started with. */
const RUNNING_STATES: readonly string[] = ["in-progress", "waiting-on-you", "paused"];

/** States of an Initiative whose Pipeline hasn't started: its Tasks start on the library's Stages. */
const OPEN_INITIATIVE_STATES: readonly string[] = ["shaping", "active"];

/**
 * Every reason the edited Pipeline can't be saved: the name is its own among the other office-wide
 * Pipelines and every Project Pipeline (`projectPipelineNames`), and the Stages can run. Who fills
 * each Role is only flagged (`pipelineEditFlags`), unlike in a Task's editor: the library outlives
 * who is hired and how (spec §2.3).
 */
export function pipelineEditProblems(
  edit: PipelineEdit,
  otherPipelines: readonly Pipeline[],
  projectPipelineNames: readonly TakenName[],
): StageProblem[] {
  const taken = [
    ...otherPipelines.map(({ name }) => ({ name, projectName: undefined })),
    ...projectPipelineNames,
  ];
  return [...pipelineNameProblems(edit.name, taken), ...stageProblems(edit.stages)];
}

/**
 * What the editor flags but saves: Agent Stages whose Role nobody fills, or whose person's Task
 * limit is none. A Task's own Stage editor refuses both, so the Task can't start on them.
 */
export function pipelineEditFlags(
  edit: PipelineEdit,
  roles: ReadonlyMap<string, RoleFilling>,
): StageProblem[] {
  return staffingProblems(edit.stages, 0, roles);
}

/**
 * Every reason a Proposal of the Pipeline's new Stages (`to`) can't be saved on it now: its Stages
 * changed since the Proposal was drafted (`from`), nothing would change, or the new Stages break a
 * rule the library editor keeps. Its name and description stay.
 */
export function proposedStagesProblems(
  pipeline: Pipeline,
  from: readonly Stage[],
  to: readonly Stage[],
  otherPipelines: readonly Pipeline[],
  projectPipelineNames: readonly TakenName[],
): StageProblem[] {
  // A draft from before flows, or one sending a plain list, reads as its conversion.
  if (!sameAsKept(flowInOrder(pipeline.stages), flowInOrder(from))) {
    return [pipelineProblem(`${pipeline.name}'s Stages changed since this was proposed.`)];
  }
  if (sameAsKept(flowInOrder(from), flowInOrder(to))) {
    return [
      pipelineProblem(
        "Nothing changes: give the Pipeline's Stages as they should be, all of them.",
      ),
    ];
  }
  return pipelineEditProblems(proposedEdit(pipeline, to), otherPipelines, projectPipelineNames);
}

/** The Pipeline with a Proposal's Stages, under its own name and description. */
export function proposedEdit(pipeline: Pipeline, stages: readonly Stage[]): PipelineEdit {
  return { name: pipeline.name, description: pipeline.description, stages };
}

/** A Pipeline made from scratch, which `pipelineEditProblems` allowed. */
export function addedPipeline(
  id: string,
  edit: PipelineEdit,
): { readonly pipeline: Pipeline; readonly event: PipelineAdded } {
  return { pipeline: pipelineOf(id, edit), event: new PipelineAdded(id) };
}

/** A library Pipeline as the user saved it, which `pipelineEditProblems` allowed. */
export function savedPipeline(
  id: string,
  edit: PipelineEdit,
): { readonly pipeline: Pipeline; readonly event: PipelineSaved } {
  return { pipeline: pipelineOf(id, edit), event: new PipelineSaved(id) };
}

/**
 * A copy of a library Pipeline under a name of its own, such as "Full (copy)", which no office-wide
 * Pipeline or Project Pipeline has. Its Stages are the original's as they are, so the copy is never
 * refused: the editor flags what needs fixing.
 */
export function copiedPipeline(
  id: string,
  original: Pipeline,
  library: readonly Pipeline[],
  projectPipelines: readonly ProjectPipeline[],
): { readonly pipeline: Pipeline; readonly event: PipelineAdded } {
  const taken = new Set([...library, ...projectPipelines].map(({ name }) => comparableName(name)));
  let name = `${original.name} (copy)`;
  for (let number = 2; taken.has(comparableName(name)); number += 1) {
    name = `${original.name} (copy ${number})`;
  }
  return {
    pipeline: { ...original, id, name },
    event: new PipelineAdded(id),
  };
}

/** Who uses the Pipeline among these Projects, Tasks, Initiatives and Project Pipelines. */
export function pipelineUse(
  pipelineId: string,
  projects: readonly ProjectOnPipeline[],
  tasks: readonly TaskOnPipeline[],
  initiatives: readonly InitiativeOnPipeline[],
  projectPipelines: readonly ProjectPipeline[],
): PipelineUse {
  const onPipeline = tasks.filter((task) => task.pipelineId === pipelineId);
  return {
    defaultFor: projects
      .filter(({ defaultPipeline }) => defaultPipeline === pipelineId)
      .map(({ id, name }) => ({ projectId: id, name })),
    notStarted: onPipeline.filter(({ state }) => NOT_STARTED_STATES.includes(state)).length,
    running: onPipeline.filter(({ state }) => RUNNING_STATES.includes(state)).length,
    initiatives: [...new Set(openInitiativesOn(pipelineId, initiatives).map(({ name }) => name))],
    projectPipelines: projectPipelines
      .filter(({ basePipelineId }) => basePipelineId === pipelineId)
      .map(({ id, name, projectId }) => ({
        id,
        name,
        projectId,
        projectName: projects.find((project) => project.id === projectId)?.name ?? projectId,
      })),
  };
}

/**
 * The shaping and active Initiatives that name the Pipeline in a Project whose Publishing Task
 * hasn't started on it: done and dropped ones need it no more, and a Publishing Task that started
 * on it walks its own copy of the Stages.
 */
function openInitiativesOn(
  pipelineId: string,
  initiatives: readonly InitiativeOnPipeline[],
): readonly InitiativeOnPipeline[] {
  return initiatives.filter(
    (initiative) =>
      initiative.pipelineId === pipelineId &&
      OPEN_INITIATIVE_STATES.includes(initiative.state) &&
      !initiative.pipelineStarted,
  );
}

/**
 * The commands the Pipeline's `stages` name that a Project running it lacks: one that has it as its
 * default, has a Task that hasn't started on it, which starts on these Stages, or is spanned by a
 * shaping or active Initiative that names it, whose Tasks do (spec §2.3). One problem per Stage and
 * Project. Keys alone count: a command left blank passes, and fails as could-not-run when it runs.
 */
export function missingCommandProblems(
  pipelineId: string,
  stages: readonly Stage[],
  projects: readonly ProjectOnPipeline[],
  tasks: readonly TaskOnPipeline[],
  initiatives: readonly InitiativeOnPipeline[],
): StageProblem[] {
  const open = openInitiativesOn(pipelineId, initiatives);
  return projects.flatMap((project) => {
    const why = whyProjectRuns(pipelineId, project, tasks, open);
    return why
      ? missingCommandsOnStages(
          stages,
          project.commands,
          0,
          (keys) => `${project.name} has no ${commandsWords(keys)} (${why})`,
        )
      : [];
  });
}

/** Why the Project runs the Pipeline, in the problem's words; `initiatives` are the open ones on it. */
function whyProjectRuns(
  pipelineId: string,
  project: ProjectOnPipeline,
  tasks: readonly TaskOnPipeline[],
  initiatives: readonly InitiativeOnPipeline[],
): string | undefined {
  if (project.defaultPipeline === pipelineId) return "it is its default Pipeline";
  const reasons = [
    notStartedTasksReason(pipelineId, project, tasks),
    initiativesReason(project, initiatives),
  ].filter((reason) => reason !== undefined);
  return reasons.length > 0 ? reasons.join("; ") : undefined;
}

function notStartedTasksReason(
  pipelineId: string,
  project: ProjectOnPipeline,
  tasks: readonly TaskOnPipeline[],
): string | undefined {
  const notStarted = tasks.filter(
    (task) =>
      task.projectId === project.id &&
      task.pipelineId === pipelineId &&
      NOT_STARTED_STATES.includes(task.state),
  ).length;
  if (notStarted === 0) return undefined;
  return notStarted === 1
    ? "a Task of it that hasn't started uses it"
    : `${notStarted} of its Tasks that haven't started use it`;
}

function initiativesReason(
  project: ProjectOnPipeline,
  initiatives: readonly InitiativeOnPipeline[],
): string | undefined {
  const names = initiatives
    .filter(({ projectId }) => projectId === project.id)
    .map(({ name }) => name);
  if (names.length === 0) return undefined;
  return names.length === 1
    ? `the Initiative ${names[0]} names it there`
    : `the Initiatives ${names.join(", ")} name it there`;
}

/**
 * Why the Pipeline can't be removed, in the UI's words; empty when it can. A Task that hasn't
 * started counts even when its Stages were edited for it: Start still needs its Pipeline. So does
 * each shaping or active Initiative that names it, whose Tasks start on it, and each Project
 * Pipeline built from it.
 */
export function removalProblems(pipelineId: string, use: PipelineUse): string[] {
  const problems: string[] = [];
  if (pipelineId === ONBOARD_PIPELINE) {
    problems.push("Onboarding uses the Onboard Pipeline, so it stays in the library.");
  }
  if (pipelineId === SET_UP_RUN_ENVIRONMENT_PIPELINE) {
    problems.push(
      "Setting up a run environment uses the Set up run environment Pipeline, so it stays in the library.",
    );
  }
  if (use.defaultFor.length > 0) {
    const names = use.defaultFor.map(({ name }) => name).join(", ");
    problems.push(`It is the default Pipeline of ${names}; choose another default first.`);
  }
  if (use.notStarted === 1) {
    problems.push("A Task that hasn't started uses it; swap that Task's Pipeline first.");
  } else if (use.notStarted > 1) {
    problems.push(
      `${use.notStarted} Tasks that haven't started use it; swap their Pipeline first.`,
    );
  }
  for (const name of use.initiatives) {
    problems.push(`The Initiative ${name} names it; choose another Pipeline for it first.`);
  }
  for (const { name, projectName } of use.projectPipelines) {
    problems.push(
      `${projectName}'s Pipeline ${name} is built from it; remove it or build it from another base Pipeline first.`,
    );
  }
  return problems;
}

function flowInOrder(stages: readonly Stage[]): Stage[] {
  return pipelineOrder(asFlow(stages));
}

function pipelineOf(id: string, { name, description, stages }: PipelineEdit): Pipeline {
  return { id, name: name.trim(), description: description.trim(), stages: flowInOrder(stages) };
}
