import type { WorkCascadeLevels } from "../domain/engine-cascade.js";

/** The Task or the Initiative a session is about, by its id. */
export type WorkLevelsOf = { readonly taskId: string } | { readonly initiativeId: string };

/** An open Task whose sessions run on its own engine override or its Initiative's, in its Project. */
export interface TaskOnWorkLevels {
  readonly taskId: string;
  readonly projectId: string;
  /** Where a refusal says it is: "On “<Task>”". */
  readonly place: string;
  readonly work: WorkCascadeLevels;
}

/**
 * The engine overrides of a Task and an Initiative, as levels of the engine cascade. A port rather than the
 * Work module itself, because Work reaches the cascade (`KnownEngineCascade`): the composition
 * root binds it to Work's adapter, which looks up a Task's Initiative, so People learns nothing
 * of Initiatives beyond their id.
 */
export abstract class KnownWorkLevels {
  /** For a Task, its own engine override and its Initiative's; for an Initiative, its own. None for none found. */
  abstract engineLevelsOf(of: WorkLevelsOf): Promise<WorkCascadeLevels>;

  /** Every Task, neither Done nor Dropped, with an engine override or whose Initiative has one. */
  abstract openTasksOnWorkLevels(): Promise<readonly TaskOnWorkLevels[]>;
}
