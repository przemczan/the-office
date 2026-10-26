import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

/**
 * Worktrees of one repository share its refs and worktree records, so two git commands writing
 * them at once fail on git's lock files (two fetches updating `refs/remotes/origin/main`, say).
 * Work on one repository runs one at a time, in arrival order, within this process. Work run
 * inside work that holds the repository's lock runs at once, so a sequence such as Publish's
 * fetch, check and push holds it throughout.
 */
@Injectable()
export class RepositoryLocks {
  /** The last work queued for each repository, removed once it finishes with nothing behind it. */
  private readonly tails = new Map<string, Promise<void>>();
  /** The repositories whose lock the running work holds. */
  private readonly heldByWork = new AsyncLocalStorage<ReadonlySet<string>>();

  /** Runs `work` once everything queued before it for `repository` has finished. */
  async run<Result>(repository: string, work: () => Promise<Result>): Promise<Result> {
    const holding = this.heldByWork.getStore() ?? new Set<string>();
    if (holding.has(repository)) return work();
    const previous = this.tails.get(repository) ?? Promise.resolve();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => released);
    this.tails.set(repository, tail);
    await previous;
    try {
      return await this.heldByWork.run(new Set([...holding, repository]), work);
    } finally {
      release();
      if (this.tails.get(repository) === tail) this.tails.delete(repository);
    }
  }
}
