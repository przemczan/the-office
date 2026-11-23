import { engineToRunOn, type Engine, type EngineId } from "../../engine/index.js";
import {
  dailyWithStarted,
  exceededCaps,
  startWaitsForUsage,
  usedUpWindows,
  windowsWithStarted,
  type DailyCapsAtStart,
  type ExceededCap,
  type UsageAtStart,
  type UsedUpAtStart,
  type WindowsAtStart,
} from "./cap-waits.js";
import { mergedUsage, movedTo, type EngineUsage, type WindowRatios } from "./usage-estimate.js";
import type { Wait } from "./wait.js";

/*
 * Stand-in Engines at Start (spec §2.1, "A queue for Start"; §5.4): a cascade's engine whose Window
 * cap the Start would pass, or whose usage window is used up, hands the Task's Stages on it to the
 * first Stand-in Engine of the list that applies that has every capability its Agent Stages need
 * and room for its estimate, whatever its engine type: the person's model and effort for that type
 * apply there. A Daily cap is a spending limit, not a used-up subscription, so it never hands a
 * Task on: it queues it.
 */

/** A Stand-in Engine a Task's run works on in place of a cascade's engine, and why. */
export interface EngineStandIn {
  /** The cascade's engine it stands in for. */
  readonly engineId: EngineId;
  readonly standInId: EngineId;
  /** Both engines' names at Start, which the Task page names them by. */
  readonly engineName: string;
  readonly standInName: string;
  /** The cascade's engine's caps or used-up windows that held it, in full. */
  readonly reason: string;
  readonly short: string;
}

/** One listed Stand-in Engine as a Start weighs it; each undefined when it has none of it. */
export interface StandInEngineAtStart {
  readonly engineId: EngineId;
  /** Undefined while no Window cap is set for it. */
  readonly windows: WindowsAtStart | undefined;
  /** Undefined while no Daily cap is set for it. */
  readonly daily: DailyCapsAtStart | undefined;
  readonly usedUp: UsedUpAtStart | undefined;
  /** Its window % per token, which the estimate moved onto it is weighed by. */
  readonly windowRatios: WindowRatios | undefined;
}

/** What a Start weighs to hand the Task's Stages to Stand-in Engines. */
export interface StandInsAtStart {
  /** The engines listed now. */
  readonly engines: readonly Engine[];
  /** The ids of the Stand-in Engine list that applies to the Task (its Project's own or the Office's), in order. */
  readonly order: readonly EngineId[];
  /** The cascade's engines the Task's Agent Stages run on, each once, in the Stages' order. */
  readonly cascadeEngines: readonly EngineId[];
  /**
   * Whether an engine has every capability the Task's Agent Stages need (Office tools, a held
   * answer); any engine has when left out.
   */
  readonly capable?: (engineId: EngineId) => boolean;
  /** Each listed Stand-in Engine of `order`, in no particular order. */
  readonly standIns: readonly StandInEngineAtStart[];
}

export const NO_STAND_INS: StandInsAtStart = {
  engines: [],
  order: [],
  cascadeEngines: [],
  standIns: [],
};

/** What a Start weighs once its Stand-in Engines are chosen. */
export interface UsageOnStandIns {
  /** The usage with each chosen stand-in in place of the engine it stands in for. */
  readonly usage: UsageAtStart;
  readonly standIns: readonly EngineStandIn[];
  /** What holds the Start for its caps; none when it can start. */
  readonly waits: readonly Wait[];
  /** When each cap or window holding it resets, any of which may free it. */
  readonly resets: readonly Date[];
}

/**
 * Whether a Start waits for the usage caps ("wait") or starts anyway past them ("start-anyway",
 * spec §2.1, "Start anyway past the usage caps"), when only a used-up window still holds an engine.
 */
export type UsageCapsChoice = "wait" | "start-anyway";

/**
 * Hands each of the cascade's engines with no room to the first capable Stand-in Engine with room,
 * then weighs the caps as a Start does. With none with room, each capable Stand-in Engine adds its
 * own wait and resets; with none capable, the waits are the caps' alone. Past the caps, room is
 * only a window not used up: the caps neither hand a Task on nor hold it.
 */
export function onStandIns(
  usage: UsageAtStart,
  standIns: StandInsAtStart,
  choice: UsageCapsChoice = "wait",
): UsageOnStandIns {
  const holding = (weighing: UsageAtStart): UsageAtStart =>
    choice === "wait" ? weighing : { ...weighing, windows: [], daily: [] };
  let weighed = usage;
  const chosen: EngineStandIn[] = [];
  const full: { readonly standIn: EngineId; readonly caps: readonly ExceededCap[] }[] = [];
  const { capable = () => true } = standIns;
  for (const engineId of standIns.cascadeEngines) {
    const noRoom = noRoomOn(holding(weighed), engineId);
    if (noRoom.length === 0) continue;
    const candidates = standIns.standIns.filter((standIn) =>
      couldTakeOn(standIns, standIn.engineId, engineId),
    );
    const capsOf = new Map(
      candidates.map((standIn) => [
        standIn.engineId,
        standInCaps(holding(weighed), engineId, holdingStandIn(standIn, choice)),
      ]),
    );
    const runOn = engineToRunOn(
      engineId,
      standIns.order,
      standIns.engines,
      (candidate) => candidate !== engineId && capsOf.get(candidate)?.length === 0,
      { capable },
    );
    const standIn = candidates.find(({ engineId: id }) => id === runOn);
    if (standIn) {
      weighed = movedOnto(weighed, engineId, standIn);
      chosen.push({
        engineId,
        standInId: standIn.engineId,
        engineName: usage.engineNames.get(engineId) ?? engineId,
        standInName: usage.engineNames.get(standIn.engineId) ?? standIn.engineId,
        reason: noRoom.map(({ words }) => words).join(" "),
        short: noRoom.map(({ short }) => short).join(" · "),
      });
    } else {
      full.push(...[...capsOf].map(([id, caps]) => ({ standIn: id, caps })));
    }
  }
  const caps = startWaitsForUsage(holding(weighed));
  const fullWaits =
    caps.waits.length === 0 || full.length === 0 ? [] : [noStandInWait(usage, full)];
  return {
    usage: weighed,
    standIns: chosen,
    waits: [...caps.waits, ...fullWaits],
    resets: [
      ...(caps.resetsAt ? [caps.resetsAt] : []),
      ...(fullWaits.length === 0 ? [] : full.flatMap(({ caps: held }) => lastReset(held))),
    ],
  };
}

/**
 * The Stand-in Engines' windows and Daily caps with `started`, a Task started in the same release,
 * counted in, as `withStarted` counts it in the cascade's.
 */
export function standInsWithStarted(
  standIns: StandInsAtStart,
  started: readonly EngineUsage[],
): StandInsAtStart {
  const startedOn = (engineId: EngineId): EngineUsage | undefined =>
    started.find((estimate) => estimate.engineId === engineId);
  return {
    ...standIns,
    standIns: standIns.standIns.map((standIn) => ({
      ...standIn,
      windows: standIn.windows && windowsWithStarted(standIn.windows, startedOn(standIn.engineId)),
      daily: standIn.daily && dailyWithStarted(standIn.daily, startedOn(standIn.engineId)),
    })),
  };
}

/**
 * Why `engineId` has no room: a Window cap the Start would pass, unless it resets within the prompt
 * cache's hour, or its usage window used up. Its Daily caps never count.
 */
function noRoomOn(usage: UsageAtStart, engineId: EngineId): ExceededCap[] {
  const alone: UsageAtStart = {
    ...usage,
    windows: usage.windows.filter((windows) => windows.engineId === engineId),
    daily: [],
    usedUp: usage.usedUp.filter((usedUp) => usedUp.engineId === engineId),
  };
  if (startWaitsForUsage(alone).waits.length === 0) return [];
  return [...usedUpWindows(alone), ...exceededCaps(alone)];
}

/** The Stand-in Engine as the choice weighs it: past the caps, by its used-up windows alone. */
function holdingStandIn(
  standIn: StandInEngineAtStart,
  choice: UsageCapsChoice,
): StandInEngineAtStart {
  return choice === "wait" ? standIn : { ...standIn, windows: undefined, daily: undefined };
}

/**
 * Whether the Stand-in Engine could take on the Task's Stages on `engineId`, room aside: another
 * engine, listed, in the list that applies and with every capability the Stages need, of any type.
 */
function couldTakeOn(
  { engines, order, capable = () => true }: StandInsAtStart,
  standInId: EngineId,
  engineId: EngineId,
): boolean {
  return (
    standInId !== engineId &&
    order.includes(standInId) &&
    engines.some(({ id }) => id === standInId) &&
    capable(standInId)
  );
}

/**
 * The caps the Stand-in Engine would pass, or its windows used up, with the Task's estimate on
 * `engineId` moved onto it beside any it has there already; none when it has room.
 */
function standInCaps(
  usage: UsageAtStart,
  engineId: EngineId,
  standIn: StandInEngineAtStart,
): ExceededCap[] {
  const onIt = usage.estimate.find((estimate) => estimate.engineId === standIn.engineId);
  const moved = movedEstimate(usage, engineId, standIn);
  const estimate = onIt && moved ? mergedUsage(onIt, moved) : (onIt ?? moved);
  const alone: UsageAtStart = {
    ...usage,
    estimate: estimate ? [estimate] : [],
    windows: standIn.windows ? [standIn.windows] : [],
    daily: standIn.daily ? [standIn.daily] : [],
    usedUp: standIn.usedUp ? [standIn.usedUp] : [],
  };
  return [...usedUpWindows(alone), ...exceededCaps(alone)];
}

/** The Task's estimate on `engineId` as it comes to on the Stand-in Engine; none without one. */
function movedEstimate(
  usage: UsageAtStart,
  engineId: EngineId,
  standIn: StandInEngineAtStart,
): EngineUsage | undefined {
  const estimate = usage.estimate.find((onEngine) => onEngine.engineId === engineId);
  return estimate && movedTo(estimate, standIn.engineId, standIn.windowRatios);
}

/**
 * The usage with the Stand-in Engine in place of `engineId`: its estimate moved onto it, and its
 * windows, Daily caps and used-up windows weighed instead of `engineId`'s.
 */
function movedOnto(
  usage: UsageAtStart,
  engineId: EngineId,
  standIn: StandInEngineAtStart,
): UsageAtStart {
  const id = standIn.engineId;
  const moved = movedEstimate(usage, engineId, standIn);
  const onIt = usage.estimate.find((estimate) => estimate.engineId === id);
  const others = usage.estimate.filter((estimate) => ![engineId, id].includes(estimate.engineId));
  const estimate = onIt && moved ? mergedUsage(onIt, moved) : (onIt ?? moved);
  const instead = <Entry extends { readonly engineId: EngineId }>(
    entries: readonly Entry[],
    standInEntry: Entry | undefined,
  ): Entry[] => {
    const kept = entries.filter((entry) => entry.engineId !== engineId);
    return standInEntry && !kept.some((entry) => entry.engineId === id)
      ? [...kept, standInEntry]
      : kept;
  };
  return {
    ...usage,
    estimate: estimate ? [...others, estimate] : others,
    windows: instead(usage.windows, standIn.windows),
    daily: instead(usage.daily, standIn.daily),
    usedUp: instead(usage.usedUp, standIn.usedUp),
  };
}

/**
 * "No Stand-in Engine has room either", with what holds each Stand-in Engine that could take the
 * Task on, of any type, as it has every capability its Agent Stages need.
 */
function noStandInWait(
  { engineNames }: UsageAtStart,
  full: readonly { readonly standIn: EngineId; readonly caps: readonly ExceededCap[] }[],
): Wait {
  const held = full.map(
    ({ standIn, caps }) =>
      `${engineNames.get(standIn) ?? standIn}: ${caps.map(({ short }) => short).join(", ")}`,
  );
  return {
    reason: `No Stand-in Engine has room either: ${[...new Set(held)].join("; ")}.`,
    short: "No stand-in with room",
  };
}

/** When the last of the caps holding a Stand-in Engine resets, which frees it. */
function lastReset(caps: readonly ExceededCap[]): Date[] {
  if (caps.length === 0) return [];
  return [new Date(Math.max(...caps.map(({ resetsAt }) => resetsAt.getTime())))];
}
