import type { EngineId } from "../../engine/index.js";
import { exceededCaps } from "./cap-waits.js";
import type { Task } from "./task.js";
import {
  reasonsBesideUsage,
  usageOnStandIns,
  type HeldAtStart,
  type StartConditions,
} from "./task-start.js";
import { reasonsOf } from "./wait.js";

/*
 * Start anyway past the usage caps (spec §2.1, "Start anyway past the usage caps"): a Task held by
 * its usage alone (a Window cap, a Daily cap, a used-up window, no Stand-in Engine with room) may
 * start at the user's word on the first engine, the cascade's then its Stand-in Engines, whose
 * window isn't used up, as an engine with a used-up window would refuse its turns at once.
 */

/** An engine the Task's Stages would run on, by its name, and the cascade's engine it stands in for. */
export interface EngineToRunOn {
  readonly name: string;
  /** Undefined on the cascade's own engine. */
  readonly standingInFor: string | undefined;
}

/** What starting the Task anyway past its usage caps does, for the user to confirm. */
export interface StartPastUsageCaps {
  /** Each cap it passes on the engines it would run on, short and named by the engine. */
  readonly passes: readonly string[];
  readonly engines: readonly EngineToRunOn[];
  /** Why it can't: every engine its Stages could run on has a used-up window. None when it can. */
  readonly refusals: readonly string[];
}

/** Start anyway past the usage caps, or undefined when anything but its usage holds the Task. */
export function startPastUsageCaps(
  task: Task,
  conditions: StartConditions,
  held: HeldAtStart,
): StartPastUsageCaps | undefined {
  const besides = reasonsBesideUsage(task, conditions, held);
  if (besides.refusals.length > 0 || besides.waits.length > 0) return undefined;
  if (usageOnStandIns(conditions).waits.length === 0) return undefined;
  const past = usageOnStandIns(conditions, "start-anyway");
  const { engineNames } = past.usage;
  const nameOf = (engineId: EngineId): string => engineNames.get(engineId) ?? engineId;
  return {
    passes: exceededCaps(past.usage).map(({ engineId, short }) => `${nameOf(engineId)}: ${short}`),
    engines: [...conditions.standIns.modelsOn.keys()].map((engineId) => {
      const standIn = past.standIns.find((chosen) => chosen.engineId === engineId);
      return standIn
        ? { name: standIn.standInName, standingInFor: standIn.engineName }
        : { name: nameOf(engineId), standingInFor: undefined };
    }),
    refusals: reasonsOf(past.waits),
  };
}
