import type { EngineId } from "./engines.js";

/** The models an engine's account listed when last asked (spec §5.4.5, "Models an engine lists"). */
export interface EngineModelList {
  readonly engineId: EngineId;
  /** By their ids, in the order the engine listed them; never empty. */
  readonly models: readonly string[];
  readonly listedAt: Date;
}

/** How old a kept list may grow before it is asked for again, in the background. */
export const MODEL_LIST_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How long after an engine was asked the background refresh leaves it be, whatever it answered:
 * one that failed or listed none stays stale, and showing the models would ask it every time.
 */
export const MODEL_LIST_ASK_GAP_MS = 60 * 60 * 1000;

/** Whether `list` is missing or older than `MODEL_LIST_REFRESH_AGE_MS` at `now`. */
export function modelListIsStale(list: EngineModelList | undefined, now: Date): boolean {
  return list === undefined || now.getTime() - list.listedAt.getTime() >= MODEL_LIST_REFRESH_AGE_MS;
}
