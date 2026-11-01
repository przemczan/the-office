import type { StageUsages, UsageRatios } from "../domain/usage-estimate.js";

/**
 * What done Tasks' Stage runs used, which Pipelines keeps; a port, since Pipelines calls Work. The
 * composition root binds it. Each keeps the latest 20 of the Tasks it is given.
 */
export abstract class UsageHistory {
  /** Each Stage's median tokens and window changes, by Stage key. */
  abstract of(doneTaskIds: readonly string[]): Promise<StageUsages>;

  /** Window % and dollars per token; given every done Task, they hold Office-wide. */
  abstract ratios(doneTaskIds: readonly string[]): Promise<UsageRatios>;
}
