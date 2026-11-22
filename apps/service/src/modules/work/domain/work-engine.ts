import type { EngineModel } from "../../engine/index.js";
import type { Initiative } from "./initiative.js";
import type { InitiativeChange } from "./initiative-changes.js";
import { InitiativeEngineSet } from "./initiative-events.js";
import { InitiativeRefused } from "./initiative-refused.js";
import type { Task, TaskSummary } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskEngineSet } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";

/**
 * A Task's and an Initiative's engine (spec 5.4.5): each sets an engine and model that takes the
 * Project default's place in the engine cascade, and a Task that sets none runs on its
 * Initiative's. Which Roles the change leaves on an engine that can't run them is Pipelines' check,
 * `TaskEngineChecks`, weighed before the change is saved.
 */

/** A Task's levels of the engine cascade: its own engine and its Initiative's. */
export interface TaskEngineLevels {
  readonly taskEngine: EngineModel | null;
  readonly initiativeEngine: EngineModel | null;
}

/**
 * One open Task whose engine a change moves, with its levels before the change and after, or whose
 * Pipeline it chooses at the levels it runs on.
 */
export interface TaskEngineMove {
  readonly taskId: string;
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
 * A change that moves Tasks' engines, or the Stages they work: setting a Task's engine or an
 * Initiative's, adding a Task to an Initiative or taking it out, choosing a Task's Pipeline, or
 * removing an engine. `place` names where, in a refusal's first words: "On “<Task>”" or
 * "In <Initiative>".
 */
export interface TaskEngineChange {
  readonly place: string;
  /** Only open Tasks: Done and Dropped ones are skipped. */
  readonly moves: readonly TaskEngineMove[];
}

export function sameEngine(one: EngineModel | null, other: EngineModel | null): boolean {
  if (one === null || other === null) return one === other;
  return one.engineId === other.engineId && one.model === other.model;
}

function isEnded({ state }: Pick<Task | Initiative, "state">): boolean {
  return state === "done" || state === "dropped";
}

/** The Task's own engine, null for none, in any state but Done and Dropped; undefined when it is already. */
export function changeTaskEngine(
  task: Task,
  engine: EngineModel | null,
): TaskChange<TaskEngineSet> | undefined {
  if (isEnded(task)) {
    throw new TaskRefused(["A Task keeps its engine once it is Done or Dropped."]);
  }
  if (sameEngine(task.engine, engine)) return undefined;
  const set = engine && { engineId: engine.engineId, model: engine.model };
  return { task: { ...task, engine: set }, event: new TaskEngineSet(task.id, set) };
}

/** The Initiative's engine, null for none, while it is shaping or active; undefined when it is already. */
export function changeInitiativeEngine(
  initiative: Initiative,
  engine: EngineModel | null,
): InitiativeChange<InitiativeEngineSet> | undefined {
  if (isEnded(initiative)) {
    throw new InitiativeRefused([`The Initiative is ${initiative.state}: it keeps its engine.`]);
  }
  if (sameEngine(initiative.engine, engine)) return undefined;
  const set = engine && { engineId: engine.engineId, model: engine.model };
  return {
    initiative: { ...initiative, engine: set },
    event: new InitiativeEngineSet(initiative.id, set),
  };
}

/** The move of setting the Task's own engine: none for a Task Done or Dropped, or no change. */
export function taskEngineMoves(
  task: Task,
  initiativeEngine: EngineModel | null,
  engine: EngineModel | null,
): TaskEngineMove[] {
  if (isEnded(task) || sameEngine(task.engine, engine)) return [];
  return [
    {
      taskId: task.id,
      projectId: task.projectId,
      before: { taskEngine: task.engine, initiativeEngine },
      after: { taskEngine: engine, initiativeEngine },
    },
  ];
}

/**
 * The moves of its Initiative's engine changing from `before` to `after` for each of `tasks`: every
 * open Task that sets no engine of its own, Publishing Tasks included; none when it doesn't change.
 */
export function inheritedEngineMoves(
  tasks: readonly Pick<TaskSummary, "id" | "projectId" | "state" | "engine">[],
  before: EngineModel | null,
  after: EngineModel | null,
): TaskEngineMove[] {
  if (sameEngine(before, after)) return [];
  return tasks
    .filter((task) => !isEnded(task) && task.engine === null)
    .map((task) => ({
      taskId: task.id,
      projectId: task.projectId,
      before: { taskEngine: null, initiativeEngine: before },
      after: { taskEngine: null, initiativeEngine: after },
    }));
}

/**
 * The move of choosing `pipelineId` for the Task, at the levels it runs on now: none for a Task Done
 * or Dropped, one following that Pipeline already, or one that neither sets an engine nor runs on
 * its Initiative's, as its Project's levels have weighed every Pipeline its Tasks may follow.
 */
export function pipelineChoiceMoves(
  task: Pick<Task, "id" | "projectId" | "state" | "engine" | "pipelineId">,
  initiativeEngine: EngineModel | null,
  pipelineId: string,
): TaskEngineMove[] {
  if (isEnded(task) || task.pipelineId === pipelineId) return [];
  if (task.engine === null && initiativeEngine === null) return [];
  const levels = { taskEngine: task.engine, initiativeEngine };
  return [
    { taskId: task.id, projectId: task.projectId, before: levels, after: levels, pipelineId },
  ];
}

/**
 * What an engine's removal moves for open Tasks, as `move` (Engine's `movedEngineModel`) moves each
 * level naming it: each Task whose own engine names it, "On “<Task>”", then each Initiative whose
 * engine names it, over its open Tasks that set none, "In <Initiative>". Done and Dropped Tasks are
 * skipped, as the checks skip them.
 */
export function removedEngineChanges(
  engineId: string,
  tasks: readonly Task[],
  initiatives: readonly Initiative[],
  move: (engine: EngineModel) => EngineModel | null,
): TaskEngineChange[] {
  const engineOf = new Map(initiatives.map(({ id, engine }) => [id, engine]));
  const open = tasks.filter((task) => !isEnded(task));
  const ownChanges = open.flatMap((task): TaskEngineChange[] => {
    if (task.engine?.engineId !== engineId) return [];
    const initiativeEngine =
      task.initiativeId === undefined ? null : (engineOf.get(task.initiativeId) ?? null);
    const moves = [
      {
        taskId: task.id,
        projectId: task.projectId,
        before: { taskEngine: task.engine, initiativeEngine },
        after: {
          taskEngine: move(task.engine),
          initiativeEngine: initiativeEngine && move(initiativeEngine),
        },
      },
    ];
    return [{ place: onTask(task), moves }];
  });
  const inheritedChanges = initiatives.flatMap((initiative): TaskEngineChange[] => {
    if (initiative.engine?.engineId !== engineId) return [];
    const itsTasks = open.filter(({ initiativeId }) => initiativeId === initiative.id);
    const moves = inheritedEngineMoves(itsTasks, initiative.engine, move(initiative.engine));
    return moves.length === 0 ? [] : [{ place: inInitiative(initiative), moves }];
  });
  return [...ownChanges, ...inheritedChanges];
}

/** An open Task that sets an engine, or whose Initiative does, with its levels and its place. */
export interface TaskOnItsEngine {
  readonly task: Task;
  readonly place: string;
  readonly levels: TaskEngineLevels;
}

/**
 * Each of `tasks` neither Done nor Dropped whose sessions run on its own engine or its Initiative's
 * (spec 5.4.5), as the capability checks of saves above a Task weigh them.
 */
export function tasksOnTheirEngines(
  tasks: readonly Task[],
  initiatives: readonly Initiative[],
): TaskOnItsEngine[] {
  const engineOf = new Map(initiatives.map(({ id, engine }) => [id, engine]));
  return tasks.flatMap((task) => {
    if (isEnded(task)) return [];
    const initiativeEngine =
      task.initiativeId === undefined ? null : (engineOf.get(task.initiativeId) ?? null);
    if (task.engine === null && initiativeEngine === null) return [];
    return [{ task, place: onTask(task), levels: { taskEngine: task.engine, initiativeEngine } }];
  });
}

/** Where a refusal of a Task's engine says it is: `On “<Task>”`. */
export function onTask({ title }: Pick<Task, "title">): string {
  return `On “${title}”`;
}

/** Where a refusal of an Initiative's engine says it is: `In <Initiative>`. */
export function inInitiative({ name }: Pick<Initiative, "name">): string {
  return `In ${name}`;
}

/**
 * The Task's own engine moved by an engine's removal (`move`, Engine's `movedEngineModel`), in any
 * state, Done and Dropped too: never refused, as the engine it names is going. Undefined when it
 * names another engine, or none.
 */
export function moveTaskEngine(
  task: Task,
  move: (engine: EngineModel) => EngineModel | null,
): TaskChange<TaskEngineSet> | undefined {
  if (task.engine === null) return undefined;
  const moved = move(task.engine);
  if (sameEngine(task.engine, moved)) return undefined;
  return { task: { ...task, engine: moved }, event: new TaskEngineSet(task.id, moved) };
}

/** As `moveTaskEngine`, for the Initiative's engine, in any state. */
export function moveInitiativeEngine(
  initiative: Initiative,
  move: (engine: EngineModel) => EngineModel | null,
): InitiativeChange<InitiativeEngineSet> | undefined {
  if (initiative.engine === null) return undefined;
  const moved = move(initiative.engine);
  if (sameEngine(initiative.engine, moved)) return undefined;
  return {
    initiative: { ...initiative, engine: moved },
    event: new InitiativeEngineSet(initiative.id, moved),
  };
}

/** The engines' names by id, which a record names an engine by; its id for one not listed. */
export type EngineNames = ReadonlyMap<string, string>;

function engineModelWords({ engineId, model }: EngineModel, names: EngineNames): string {
  return `${model} on ${names.get(engineId) ?? engineId}`;
}

/**
 * The record's line of the engine a Task sets, or the Initiative's it runs on while it sets none;
 * none when neither is set, as it runs on the Project's engine cascade then.
 */
export function taskEngineLines(
  task: Pick<Task, "engine">,
  initiativeEngine: EngineModel | null,
  names: EngineNames,
): string[] {
  if (task.engine) return [`- Engine: ${engineModelWords(task.engine, names)}`];
  if (initiativeEngine) {
    return [`- Engine: the Initiative's engine (${engineModelWords(initiativeEngine, names)})`];
  }
  return [];
}

/** The record's line of the engine an Initiative sets; none when it sets none. */
export function initiativeEngineLines(
  initiative: Pick<Initiative, "engine">,
  names: EngineNames,
): string[] {
  return initiative.engine ? [`- Engine: ${engineModelWords(initiative.engine, names)}`] : [];
}
