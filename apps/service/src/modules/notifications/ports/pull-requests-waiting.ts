import type { PullRequestNeedingAttention } from "../domain/now.js";

/**
 * The open pull requests The Office opened whose checks fail or which have conflicts, as last read;
 * the composition root binds it.
 */
export abstract class PullRequestsWaiting {
  abstract needingAttention(): Promise<readonly PullRequestNeedingAttention[]>;
}
