import type {
  EngineId,
  EngineModel,
  EngineSettings,
  Initiative,
  Project,
  Task,
  TaskSummary,
} from "@the-office/contracts";
import { modelLabel, officeDefaultEngineModel } from "../../shell/engine-words.ts";

/** An engine's name as Settings › Engines lists it. */
type EngineNamer = (engineId: EngineId) => string;

/** The Engine fold's words on the Task page and the Initiative page (spec §2.1.3, §2.1.4). */
export const TASK_ENGINE_INTRO =
  "What every session about this Task runs on: its Stages, its planning Thread and Consultations on it. It takes the Project default's place; a Role override still wins.";
export const INITIATIVE_ENGINE_INTRO =
  "What its shaping and planning Threads run on, and every Task in it that sets no engine of its own. It takes the Project default's place; a Role override still wins.";
export const TASK_ENGINE_KEPT =
  "Kept as it was: the engine of a Done or Dropped Task doesn't change.";
export const INITIATIVE_ENGINE_KEPT =
  "Kept as it was: the engine of a Done or Dropped Initiative doesn't change.";
export const ENGINE_CHANGE_NOTE =
  "A new engine starts each next session fresh; a new model alone resumes it.";
export const RUNNING_STAGE_NOTE =
  "A Stage is running now. That session finishes on the engine it started on; a change applies from each next session.";
export const ENGINE_REFUSED = "The engine wasn't saved";
export const PROJECTS_ENGINE = "Project's engine";
export const EACH_PROJECTS_ENGINE = "Each Project's engine";
export const RUNS_ON_NOTE =
  "Its Planner and the Roles its Stages name, as the engine cascade gives them now. A Consultant on it runs the same way.";
export const INITIATIVE_NONE_HINT =
  "A Task in it that sets no engine runs on its Project default, or the Office default where its Project has none.";
export const ITS_TASKS_NOTE =
  "The level each open Task takes; its Role overrides still win. Done and Dropped Tasks run no more sessions, so they aren't listed.";

/** "Opus 5.5 on Work account". */
export function onEngine({ engineId, model }: EngineModel, engineName: EngineNamer): string {
  return `${modelLabel(model)} on ${engineName(engineId)}`;
}

/**
 * What a Project's Tasks run on while nothing more specific is set: its default, else the Office
 * default's account on that engine's own default model.
 */
export function projectEngineOf(
  project: Pick<Project, "projectDefault"> | undefined,
  engineSettings: Pick<EngineSettings, "engines" | "officeDefault"> | undefined,
): EngineModel | null {
  return project?.projectDefault ?? officeDefaultEngineModel(engineSettings);
}

/** The Engine fold's summary: what the Task sets, else what it takes. */
export function taskEngineSummary(
  task: Pick<Task, "engine" | "initiativeEngine">,
  projectEngine: EngineModel | null,
  engineName: EngineNamer,
): string {
  if (task.engine) return `${onEngine(task.engine, engineName)} · set for this Task`;
  if (task.initiativeEngine) {
    return `Initiative's engine · ${onEngine(task.initiativeEngine, engineName)}`;
  }
  return projectEngine
    ? `${PROJECTS_ENGINE} · ${onEngine(projectEngine, engineName)}`
    : PROJECTS_ENGINE;
}

/** The Task's Engine field's empty choice, which names what it takes then. */
export function taskNoneLabel(
  task: Pick<Task, "initiativeEngine">,
  engineName: EngineNamer,
): string {
  return task.initiativeEngine
    ? `Initiative's engine (${onEngine(task.initiativeEngine, engineName)})`
    : PROJECTS_ENGINE;
}

/** The hint under the Task's Engine field while it sets none. */
export function taskNoneHint(
  task: Pick<Task, "initiativeEngine">,
  project: Pick<Project, "name" | "projectDefault"> | undefined,
): string {
  const pick = "Pick an engine to run this Task on its own.";
  if (task.initiativeEngine) return `Set on its Initiative. ${pick}`;
  if (project === undefined) return pick;
  return project.projectDefault
    ? `${project.name}'s Project default. ${pick}`
    : `The Office default, as ${project.name} has no Project default. ${pick}`;
}

/** The toast once the Task's engine is saved; `inherited` is what it took before setting one. */
export function taskEngineToast(
  task: Pick<Task, "title" | "initiativeEngine">,
  before: EngineModel | null,
  after: EngineModel | null,
  inherited: EngineModel | null,
  engineName: EngineNamer,
): string {
  if (after === null) {
    const whose = task.initiativeEngine ? "Initiative's" : "Project's";
    return `${task.title} has no engine of its own now: it runs on its ${whose} engine from its next session.`;
  }
  const was = before ?? inherited;
  if (was?.engineId === after.engineId) {
    return `Model saved for ${task.title}: its next sessions resume, on ${modelLabel(after.model)}.`;
  }
  return `Engine saved for ${task.title}: its next sessions start fresh, on ${onEngine(after, engineName)}.`;
}

/** The Initiative's empty choice: its Project's engine, or each Project's across several. */
export function initiativeNoneLabel(initiative: Pick<Initiative, "projectIds">): string {
  return initiative.projectIds.length > 1 ? EACH_PROJECTS_ENGINE : PROJECTS_ENGINE;
}

/** The Initiative's Engine fold's summary. */
export function initiativeEngineSummary(
  initiative: Pick<Initiative, "engine" | "projectIds">,
  projectEngine: EngineModel | null,
  engineName: EngineNamer,
): string {
  if (initiative.engine) return onEngine(initiative.engine, engineName);
  if (initiative.projectIds.length > 1) return EACH_PROJECTS_ENGINE;
  return projectEngine
    ? `${PROJECTS_ENGINE} · ${onEngine(projectEngine, engineName)}`
    : PROJECTS_ENGINE;
}

/** The toast once the Initiative's engine is saved; `taking` counts its open Tasks that set none. */
export function initiativeEngineToast(
  initiative: Pick<Initiative, "name">,
  before: EngineModel | null,
  after: EngineModel | null,
  taking: number,
  engineName: EngineNamer,
): string {
  if (after === null) {
    return `${initiative.name} has no engine of its own now: its Threads and Tasks run on their Project's engine from their next session.`;
  }
  if (before?.engineId === after.engineId) {
    return `Model saved for ${initiative.name}: its next sessions resume, on ${modelLabel(after.model)}.`;
  }
  const tasks =
    taking === 1
      ? "its 1 open Task that sets none runs"
      : `its ${taking} open Tasks that set none run`;
  return `Engine saved for ${initiative.name}: its Threads and ${tasks} on ${onEngine(after, engineName)} from their next session.`;
}

/** Whether the Task runs sessions still, so the Initiative's engine can apply to it. */
export function isOpenTask({ state }: Pick<TaskSummary, "state">): boolean {
  return state !== "done" && state !== "dropped";
}

/** What one of an Initiative's open Tasks runs on, and the level it takes it from. */
export interface InitiativeTaskEngine {
  readonly engine: EngineModel | null;
  readonly source: "its own engine" | "the Initiative's engine" | "its Project's engine";
}

export function initiativeTaskEngine(
  task: Pick<TaskSummary, "engine">,
  initiative: Pick<Initiative, "engine">,
  projectEngine: EngineModel | null,
): InitiativeTaskEngine {
  if (task.engine) return { engine: task.engine, source: "its own engine" };
  if (initiative.engine) return { engine: initiative.engine, source: "the Initiative's engine" };
  return { engine: projectEngine, source: "its Project's engine" };
}
