import type {
  EngineId,
  EngineSettings,
  Initiative,
  Project,
  Task,
  TaskSummary,
} from "@the-office/contracts";

/** An engine's name as Settings › Engines lists it. */
type EngineNamer = (engineId: EngineId) => string;

/** The Engine fold's words on the Task page and the Initiative page (spec §2.1.3, §2.1.4). */
export const OVERRIDE_THE_ENGINE = "Override the engine";
export const TASK_ENGINE_KEPT =
  "Kept as it was: the engine of a Done or Dropped Task doesn't change.";
export const INITIATIVE_ENGINE_KEPT =
  "Kept as it was: the engine of a Done or Dropped Initiative doesn't change.";
export const RUNNING_STAGE_NOTE =
  "A Stage is running now. That session finishes on the engine it started on; a change applies from each next session, which starts fresh on the new engine.";
export const ENGINE_REFUSED = "The engine wasn't saved";
export const EACH_PROJECTS_ENGINE = "Each Project's engine";
export const NO_ENGINE_LISTED = "No engine: add one in Settings › Engines";
export const RUNS_ON_NOTE =
  "Its Planner and the Roles its Stages name, with the model and effort each works with on its engine now. A Consultant on it works the same way.";
export const TASK_FOLLOWS_INITIATIVE_HINT =
  "Turn it on to run this Task on another engine than its Initiative's.";
export const INITIATIVE_OFF_HINT =
  "Its Threads and Tasks run on their Project's engine, or the Office default where the Project sets none, with that Project's Stand-in Engines.";
export const ITS_TASKS_NOTE =
  "Which of its open Tasks follow its override and which override it with their own engine. Done and Dropped Tasks run no more sessions, so they aren't listed.";

/** The engine a record follows while it has no override of its own, and the level that gives it. */
export interface FollowedEngine {
  readonly engineId: EngineId;
  readonly from: "initiative" | "project" | "office";
}

/**
 * What a Project's Tasks run on while nothing more specific is set: the engine its default names,
 * else the Office default's; none while neither is listed or the settings aren't read yet.
 */
export function projectEngineOf(
  project: { readonly engine: Pick<Project["engine"], "default"> } | undefined,
  engineSettings: Pick<EngineSettings, "engines" | "officeDefault"> | undefined,
): FollowedEngine | null {
  const listed = (engineId: EngineId | undefined): boolean =>
    engineId !== undefined && (engineSettings?.engines ?? []).some(({ id }) => id === engineId);
  const projectEngineId = project?.engine.default?.engineId;
  if (listed(projectEngineId) && projectEngineId !== undefined) {
    return { engineId: projectEngineId, from: "project" };
  }
  const officeEngineId = engineSettings?.officeDefault?.engineId;
  if (listed(officeEngineId) && officeEngineId !== undefined) {
    return { engineId: officeEngineId, from: "office" };
  }
  return null;
}

/** What the Task follows with its own override off: its Initiative's override, else its Project's. */
export function taskFollowedEngine(
  task: Pick<Task, "initiativeEngineOverride">,
  projectEngine: FollowedEngine | null,
): FollowedEngine | null {
  if (task.initiativeEngineOverride) {
    return { engineId: task.initiativeEngineOverride, from: "initiative" };
  }
  return projectEngine;
}

/** "· from the Project": where an engine a record follows comes from, in the summary. */
function fromWords({ from }: FollowedEngine): string {
  switch (from) {
    case "initiative":
      return "from its Initiative · no stand-ins";
    case "project":
      return "from the Project";
    case "office":
      return "from the Office default";
  }
}

/** The Task's Engine fold's summary: its override, else what it follows. */
export function taskEngineSummary(
  task: Pick<Task, "engineOverride" | "initiativeEngineOverride">,
  projectEngine: FollowedEngine | null,
  engineName: EngineNamer,
): string {
  if (task.engineOverride) {
    return `${engineName(task.engineOverride)} · set for this Task · no stand-ins`;
  }
  const followed = taskFollowedEngine(task, projectEngine);
  return followed ? `${engineName(followed.engineId)} · ${fromWords(followed)}` : NO_ENGINE_LISTED;
}

/**
 * The line under the switch while it is off, naming the engine the Task follows and the stand-ins
 * it has there: the Project's own list while it uses one, else the Office's.
 */
export function taskFollowsLine(
  followed: FollowedEngine | null,
  projectUsesOwnStandIns: boolean,
  engineName: EngineNamer,
): string {
  if (followed === null) return NO_ENGINE_LISTED;
  const name = engineName(followed.engineId);
  if (followed.from === "initiative") {
    return `Runs on ${name}, from its Initiative, with no stand-ins.`;
  }
  const standIns = projectUsesOwnStandIns
    ? "the Project's Stand-in Engines"
    : "the Office's Stand-in Engines";
  const from = followed.from === "project" ? "the Project" : "the Office default";
  return `Runs on ${name}, from ${from}, with ${standIns}.`;
}

/** The info note under the Engine select. */
export function noStandInsNote(
  engineId: EngineId,
  engineName: EngineNamer,
  of: "task" | "initiative",
): string {
  const waits = of === "task" ? "the Task waits" : "its Tasks wait";
  return `No stand-ins: when ${engineName(engineId)}'s usage window is used up, ${waits} for the reset.`;
}

/** The toast once the Task's engine override is saved, or turned off. */
export function taskEngineToast(
  task: Pick<Task, "title" | "initiativeEngineOverride">,
  after: EngineId | null,
  engineName: EngineNamer,
): string {
  if (after === null) {
    const whose = task.initiativeEngineOverride ? "Initiative's" : "Project's";
    return `${task.title} follows its ${whose} engine again.`;
  }
  return `${task.title} runs on ${engineName(after)}, with no stand-ins.`;
}

/** The Initiative's Engine fold's summary: its override, else its Project's engine. */
export function initiativeEngineSummary(
  initiative: Pick<Initiative, "engineOverride" | "projectIds">,
  projectEngine: FollowedEngine | null,
  engineName: EngineNamer,
): string {
  if (initiative.engineOverride) {
    return `${engineName(initiative.engineOverride)} · set for this Initiative · no stand-ins`;
  }
  if (initiative.projectIds.length > 1) return EACH_PROJECTS_ENGINE;
  return projectEngine
    ? `${engineName(projectEngine.engineId)} · ${fromWords(projectEngine)}`
    : NO_ENGINE_LISTED;
}

/** The toast once the Initiative's engine override is saved, or turned off. */
export function initiativeEngineToast(
  initiative: Pick<Initiative, "name">,
  after: EngineId | null,
  engineName: EngineNamer,
): string {
  if (after === null) {
    return `${initiative.name} has no engine of its own now: its Threads and Tasks run on their Project's engine from their next session.`;
  }
  return `${initiative.name} runs on ${engineName(after)}, with no stand-ins.`;
}

/** Whether the Task runs sessions still, so the Initiative's override can apply to it. */
export function isOpenTask({ state }: Pick<TaskSummary, "state">): boolean {
  return state !== "done" && state !== "dropped";
}

/** What one of an Initiative's open Tasks runs on, and the level it takes it from. */
export interface InitiativeTaskEngine {
  readonly engineId: EngineId | null;
  readonly source:
    "its own override" | "follows the Initiative's override" | "its Project's engine";
}

export function initiativeTaskEngine(
  task: Pick<TaskSummary, "engineOverride">,
  initiative: Pick<Initiative, "engineOverride">,
  projectEngine: FollowedEngine | null,
): InitiativeTaskEngine {
  if (task.engineOverride) return { engineId: task.engineOverride, source: "its own override" };
  if (initiative.engineOverride) {
    return { engineId: initiative.engineOverride, source: "follows the Initiative's override" };
  }
  return { engineId: projectEngine?.engineId ?? null, source: "its Project's engine" };
}
