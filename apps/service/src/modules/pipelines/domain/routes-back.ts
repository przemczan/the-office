import type { GridStage } from "./flow.js";
import { ENDED_FAILED, ROUTE_LIMIT_MAX, type Route } from "./route.js";
import type { Stage } from "./stage.js";

/**
 * The on-failure setting the previous releases kept on an Agent or Script Stage, "On failure go back
 * to Stage X, at most N times". Stored Pipelines, Task's Stages and Proposals still carry it, as
 * they are never rewritten; `withRoutesBack` reads it as a route.
 */
export interface KeptOnFailure {
  /** The key of the Stage it went back to. */
  readonly goBackTo: string;
  readonly rounds: number;
}

/** A Stage as kept, with the on-failure setting a previous release may have saved on it. */
export type KeptStage<Of extends Stage = Stage> = Of & { readonly onFailure?: KeptOnFailure };

/**
 * `stages` with each kept on-failure setting read as a failure route back (spec §2.3, "When a Stage
 * fails"): placed first among the Stage's routes, to `goBackTo` while the Stage ended Failed, at
 * most its rounds (9 at most), and the setting dropped. A Stage without one is as it was, so reading twice
 * changes nothing. Only `asFlow` calls it, as the stored data stays as it is.
 */
export function withRoutesBack(stages: readonly KeptStage<GridStage>[]): GridStage[] {
  const names = new Map(stages.map(({ key, name }) => [key, name]));
  return stages.map((stage) => {
    const { onFailure, ...rest } = stage;
    if (onFailure === undefined) return stage;
    const name = names.get(onFailure.goBackTo);
    const routeBack: Route = {
      to: onFailure.goBackTo,
      ...(name === undefined ? {} : { toName: name }),
      condition: ENDED_FAILED,
      // Only the old editor capped rounds at 9; an agent or the API could keep more, which a
      // route's limit can't be, so such a setting reads as the most a limit is.
      limit: Math.min(onFailure.rounds, ROUTE_LIMIT_MAX),
    };
    return { ...rest, routes: [routeBack, ...rest.routes] } as GridStage;
  });
}
