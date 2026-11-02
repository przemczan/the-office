import type { StageUsages } from "../domain/usage-estimate.js";

/**
 * What done Tasks' Stage runs used, which Pipelines keeps; a port, since Pipelines calls Work. The
 * composition root binds it. Each keeps the latest 20 of the Tasks it is given.
 */
export abstract class UsageHistory {
  /** Each Stage's median tokens, by Stage key. */
  abstract of(doneTaskIds: readonly string[]): Promise<StageUsages>;

  /** Dollars per counted token at the current Model prices; given every done Task, Office-wide. */
  abstract dollarsPerToken(doneTaskIds: readonly string[]): Promise<number | undefined>;
}
