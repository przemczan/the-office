import type { Effort, EngineId, EngineKind } from "../../engine/index.js";
import type { Initiative } from "./initiative.js";
import type { InitiativeChange } from "./initiative-changes.js";
import { InitiativeEngineOverrideSet } from "./initiative-events.js";
import { InitiativeRefused } from "./initiative-refused.js";
import type { Task, TaskSummary } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskEngineOverrideSet } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";

/**
 * A Task's and an Initiative's engine override (spec 5.4.5): each names one engine, which wins over
 * the Project default and the Office default and never gives way to a Stand-in Engine; a Task's
 * wins over its Initiative's. It names no model: each person works with their own for its type.
 * Which Roles the change leaves on an engine that can't run them is Pipelines' check,
 * `TaskEngineChecks`, weighed before the change is saved.
 */

/** A model and an effort, each null for "Unchanged": what the levels below give. */
export interface TaskModelAndEffort {
  readonly model: string | null;
  readonly effort: Effort | null;
}

/**
 * The Task's setting for one person (spec 5.4.5), on each engine type, the most specific level of
 * the model and effort cascade.
 */
export interface TaskPersonEngine {
  readonly roleKey: string;
  readonly engineSettings: Partial<Record<EngineKind, TaskModelAndEffort>>;
}

/** A Task's engine overrides: its own and its Initiative's. */
export interface TaskEngineLevels {
  readonly taskEngineOverride: EngineId | null;
  readonly initiativeEngineOverride: EngineId | null;
}

/**
 * One open Task whose engine a change moves, with its levels before the change and after, or whose
 * Pipeline it chooses at the levels it runs on.
 */
export interface TaskEngineMove {
  readonly taskId: string;
  /** In an Initiative's change, the Task's title, which its refusal names ("… need on “<Task>”"). */
  readonly taskTitle?: string;
  readonly projectId: string;
  readonly before: TaskEngineLevels;
  readonly after: TaskEngineLevels;
  /**
   * The Pipeline the change chooses for the Task, whose Stages it works after the change in place
   * of those it works now; undefined when its Stages stay.
   */
  readonly pipelineId?: string;
}

/**
 * A change that moves Tasks' engines, or the Stages they work: setting a Task's engine override or
 * an Initiative's, adding a Task to an Initiative or taking it out, choosing a Task's Pipeline, or
 * removing an engine. `place` names where, in a refusal's first words: "On “<Task>”" or
 * "In <Initiative>".
 */
export interface TaskEngineChange {
  readonly place: string;
  /** Only open Tasks: Done and Dropped ones are skipped. */
  readonly moves: readonly TaskEngineMove[];
}

export function sameEngine(one: EngineId | null, other: EngineId | null): boolean {
  return one === other;
}

function isEnded({ state }: Pick<Task | Initiative, "state">): boolean {
  return state === "done" || state === "dropped";
}

/**
 * The Task's engine override, null for none, and its setting for each person (`people`: undefined
 * keeps the saved ones, empty clears them), in any state but Done and Dropped; undefined when both
 * are already so.
 */
export function changeTaskEngine(
  task: Task,
  engineId: EngineId | null,
  people?: readonly TaskPersonEngine[],
): TaskChange<TaskEngineOverrideSet> | undefined {
  if (isEnded(task)) {
    throw new TaskRefused([
      "A Task keeps its engine override and its models and efforts once it is Done or Dropped.",
    ]);
  }
  const peopleEngineSettings = people === undefined ? task.peopleEngineSettings : kept(people);
  if (
    sameEngine(task.engineOverride, engineId) &&
    samePeople(task.peopleEngineSettings, peopleEngineSettings)
  ) {
    return undefined;
  }
  return {
    task: { ...task, engineOverride: engineId, peopleEngineSettings },
    event: new TaskEngineOverrideSet(task.id, engineId),
  };
}

/**
 * The Task's settings for people as they are kept: a person named twice is refused, and a person or
 * an engine type with nothing set (both fields Unchanged) isn't kept.
 */
function kept(people: readonly TaskPersonEngine[]): TaskPersonEngine[] {
  if (new Set(people.map(({ roleKey }) => roleKey)).size !== people.length) {
    throw new TaskRefused(["Name each person once."]);
  }
  return people.flatMap(({ roleKey, engineSettings }) => {
    const set = Object.entries(engineSettings).filter(
      ([, { model, effort }]) => model !== null || effort !== null,
    );
    return set.length === 0 ? [] : [{ roleKey, engineSettings: Object.fromEntries(set) }];
  });
}

function samePeople(first: readonly TaskPersonEngine[], second: readonly TaskPersonEngine[]) {
  return JSON.stringify(first) === JSON.stringify(second);
}

/** The Initiative's engine override, null for none, while it is shaping or active; undefined when it is already. */
export function changeInitiativeEngine(
  initiative: Initiative,
  engineId: EngineId | null,
): InitiativeChange<InitiativeEngineOverrideSet> | undefined {
  if (isEnded(initiative)) {
    throw new InitiativeRefused([
      `The Initiative is ${initiative.state}: it keeps its engine override.`,
    ]);
  }
  if (sameEngine(initiative.engineOverride, engineId)) return undefined;
  return {
    initiative: { ...initiative, engineOverride: engineId },
    event: new InitiativeEngineOverrideSet(initiative.id, engineId),
  };
}

/** The move of setting the Task's engine override: none for a Task Done or Dropped, or no change. */
export function taskEngineMoves(
  task: Task,
  initiativeEngineOverride: EngineId | null,
  engineId: EngineId | null,
): TaskEngineMove[] {
  if (isEnded(task) || sameEngine(task.engineOverride, engineId)) return [];
  return [
    {
      taskId: task.id,
      projectId: task.projectId,
      before: { taskEngineOverride: task.engineOverride, initiativeEngineOverride },
      after: { taskEngineOverride: engineId, initiativeEngineOverride },
    },
  ];
}

/**
 * The moves of its Initiative's engine override changing from `before` to `after` for each of
 * `tasks`: every open Task with no override of its own, Publishing Tasks included; none when it
 * doesn't change.
 */
export function inheritedEngineMoves(
  tasks: readonly Pick<TaskSummary, "id" | "title" | "projectId" | "state" | "engineOverride">[],
  before: EngineId | null,
  after: EngineId | null,
): TaskEngineMove[] {
  if (sameEngine(before, after)) return [];
  return tasks
    .filter((task) => !isEnded(task) && task.engineOverride === null)
    .map((task) => ({
      taskId: task.id,
      taskTitle: task.title,
      projectId: task.projectId,
      before: { taskEngineOverride: null, initiativeEngineOverride: before },
      after: { taskEngineOverride: null, initiativeEngineOverride: after },
    }));
}

/**
 * The move of choosing `pipelineId` for the Task, at the levels it runs on now: none for a Task Done
 * or Dropped, one following that Pipeline already, or one with no engine override of its own or its
 * Initiative's, as its Project's levels have weighed every Pipeline its Tasks may follow.
 */
export function pipelineChoiceMoves(
  task: Pick<Task, "id" | "projectId" | "state" | "engineOverride" | "pipelineId">,
  initiativeEngineOverride: EngineId | null,
  pipelineId: string,
): TaskEngineMove[] {
  if (isEnded(task) || task.pipelineId === pipelineId) return [];
  if (task.engineOverride === null && initiativeEngineOverride === null) return [];
  const levels = { taskEngineOverride: task.engineOverride, initiativeEngineOverride };
  return [
    { taskId: task.id, projectId: task.projectId, before: levels, after: levels, pipelineId },
  ];
}

/**
 * What an engine's removal moves for open Tasks, as `move` moves each override naming it (to the
 * replacement, or none): each Task whose own override names it, "On “<Task>”", then each
 * Initiative whose override names it, over its open Tasks with none of their own,
 * "In <Initiative>". Done and Dropped Tasks are skipped, as the checks skip them.
 */
export function removedEngineChanges(
  engineId: EngineId,
  tasks: readonly Task[],
  initiatives: readonly Initiative[],
  move: (engineId: EngineId) => EngineId | null,
): TaskEngineChange[] {
  const overrideOf = new Map(initiatives.map(({ id, engineOverride }) => [id, engineOverride]));
  const open = tasks.filter((task) => !isEnded(task));
  const ownChanges = open.flatMap((task): TaskEngineChange[] => {
    if (task.engineOverride !== engineId) return [];
    const initiativeEngineOverride =
      task.initiativeId === undefined ? null : (overrideOf.get(task.initiativeId) ?? null);
    const moves = [
      {
        taskId: task.id,
        projectId: task.projectId,
        before: { taskEngineOverride: task.engineOverride, initiativeEngineOverride },
        after: {
          taskEngineOverride: move(task.engineOverride),
          initiativeEngineOverride: initiativeEngineOverride && move(initiativeEngineOverride),
        },
      },
    ];
    return [{ place: onTask(task), moves }];
  });
  const inheritedChanges = initiatives.flatMap((initiative): TaskEngineChange[] => {
    if (initiative.engineOverride !== engineId) return [];
    const itsTasks = open.filter(({ initiativeId }) => initiativeId === initiative.id);
    const moves = inheritedEngineMoves(
      itsTasks,
      initiative.engineOverride,
      move(initiative.engineOverride),
    );
    return moves.length === 0 ? [] : [{ place: inInitiative(initiative), moves }];
  });
  return [...ownChanges, ...inheritedChanges];
}

/** An open Task with an engine override, its own or its Initiative's, with its levels and its place. */
export interface TaskOnItsEngine {
  readonly task: Task;
  readonly place: string;
  readonly levels: TaskEngineLevels;
}

/**
 * Each of `tasks` neither Done nor Dropped under an engine override, its own or its Initiative's
 * (spec 5.4.5), as the capability checks of saves above a Task weigh them.
 */
export function tasksOnTheirEngines(
  tasks: readonly Task[],
  initiatives: readonly Initiative[],
): TaskOnItsEngine[] {
  const overrideOf = new Map(initiatives.map(({ id, engineOverride }) => [id, engineOverride]));
  return tasks.flatMap((task) => {
    if (isEnded(task)) return [];
    const initiativeEngineOverride =
      task.initiativeId === undefined ? null : (overrideOf.get(task.initiativeId) ?? null);
    if (task.engineOverride === null && initiativeEngineOverride === null) return [];
    const levels = { taskEngineOverride: task.engineOverride, initiativeEngineOverride };
    return [{ task, place: onTask(task), levels }];
  });
}

/** Where a refusal of a Task's engine override says it is: `On “<Task>”`. */
export function onTask({ title }: Pick<Task, "title">): string {
  return `On “${title}”`;
}

/** Where a refusal of an Initiative's engine override says it is: `In <Initiative>`. */
export function inInitiative({ name }: Pick<Initiative, "name">): string {
  return `In ${name}`;
}

/**
 * The Task's engine override moved by an engine's removal (`move`: to the replacement, or none), in
 * any state, Done and Dropped too: never refused, as the engine it names is going. Undefined when
 * it names another engine, or none.
 */
export function moveTaskEngine(
  task: Task,
  move: (engineId: EngineId) => EngineId | null,
): TaskChange<TaskEngineOverrideSet> | undefined {
  if (task.engineOverride === null) return undefined;
  const moved = move(task.engineOverride);
  if (sameEngine(task.engineOverride, moved)) return undefined;
  return {
    task: { ...task, engineOverride: moved },
    event: new TaskEngineOverrideSet(task.id, moved),
  };
}

/** As `moveTaskEngine`, for the Initiative's engine override, in any state. */
export function moveInitiativeEngine(
  initiative: Initiative,
  move: (engineId: EngineId) => EngineId | null,
): InitiativeChange<InitiativeEngineOverrideSet> | undefined {
  if (initiative.engineOverride === null) return undefined;
  const moved = move(initiative.engineOverride);
  if (sameEngine(initiative.engineOverride, moved)) return undefined;
  return {
    initiative: { ...initiative, engineOverride: moved },
    event: new InitiativeEngineOverrideSet(initiative.id, moved),
  };
}

/** The engines' names by id, which a record names an engine by; its id for one not listed. */
export type EngineNames = ReadonlyMap<string, string>;

/**
 * The record's line of the Task's engine override, or its Initiative's that applies while it has
 * none; none when neither is set, as it runs on the Project's engine cascade then.
 */
export function taskEngineLines(
  task: Pick<Task, "engineOverride">,
  initiativeEngineOverride: EngineId | null,
  names: EngineNames,
): string[] {
  const name = (engineId: EngineId) => names.get(engineId) ?? engineId;
  if (task.engineOverride) {
    return [`- Engine override: ${name(task.engineOverride)}, set for this Task, no stand-ins`];
  }
  if (initiativeEngineOverride) {
    return [
      `- Engine override: ${name(initiativeEngineOverride)}, from its Initiative, no stand-ins`,
    ];
  }
  return [];
}

/** The record's line of the Initiative's engine override; none when it has none. */
export function initiativeEngineLines(
  initiative: Pick<Initiative, "engineOverride">,
  names: EngineNames,
): string[] {
  const { engineOverride } = initiative;
  return engineOverride
    ? [`- Engine override: ${names.get(engineOverride) ?? engineOverride}, no stand-ins`]
    : [];
}
