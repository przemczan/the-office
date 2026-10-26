import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Work on one key runs one at a time, in arrival order, within this process. Work run inside work
 * that holds the key's lock runs at once, so a sequence can hold a key throughout.
 */
export class KeyedLocks {
  /** The last work queued for each key, removed once it finishes with nothing behind it. */
  private readonly tails = new Map<string, Promise<void>>();
  /** The keys whose lock the running work holds. */
  private readonly heldByWork = new AsyncLocalStorage<ReadonlySet<string>>();

  /** Runs `work` once everything queued before it for `key` has finished. */
  async run<Result>(key: string, work: () => Promise<Result>): Promise<Result> {
    const holding = this.heldByWork.getStore() ?? new Set<string>();
    if (holding.has(key)) return work();
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => released);
    this.tails.set(key, tail);
    await previous;
    try {
      return await this.heldByWork.run(new Set([...holding, key]), work);
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
