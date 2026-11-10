import { Injectable } from "@nestjs/common";
import { RunEnvironmentSettings } from "../ports/run-environment-settings.js";

interface Waiter {
  readonly taskId: string;
  readonly resolve: () => void;
}

/**
 * Run environments at once (spec §5.5, "Limits"): a Task's run environment holds a slot while it
 * is running, and one that would pass the setting waits, first come first served, until a slot is
 * released. Kept in memory: at start no run environment is running (the startup sweep stops them).
 */
@Injectable()
export class RunEnvironmentSlots {
  private readonly holders = new Set<string>();
  private readonly waiting: Waiter[] = [];

  constructor(private readonly settings: RunEnvironmentSettings) {}

  /**
   * Takes a slot for the Task, at once when it holds one already or one is free; else calls
   * `onWaiting` and waits for its turn. A stop while waiting gives up its place and throws.
   */
  async take(taskId: string, onWaiting: () => void, signal?: AbortSignal): Promise<void> {
    if (this.holders.has(taskId)) return;
    signal?.throwIfAborted();
    const limit = await this.limit();
    if (this.waiting.length === 0 && this.holders.size < limit) {
      this.holders.add(taskId);
      return;
    }
    onWaiting();
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        taskId,
        resolve: () => {
          signal?.removeEventListener("abort", stop);
          resolve();
        },
      };
      const stop = (): void => {
        this.waiting.splice(this.waiting.indexOf(waiter), 1);
        reject(signal?.reason instanceof Error ? signal.reason : new Error("Stopped."));
      };
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error("Stopped."));
        return;
      }
      signal?.addEventListener("abort", stop, { once: true });
      this.waiting.push(waiter);
    });
  }

  /** Frees the Task's slot, if it holds one, for the first one waiting. */
  async release(taskId: string): Promise<void> {
    if (!this.holders.delete(taskId)) return;
    await this.admitWaiting();
  }

  /**
   * Hands the free slots to the waiting, first come first served: after a release, or once
   * Settings raised the limit. A lowered limit takes no slot away; new ones wait until fewer hold one.
   */
  async admitWaiting(): Promise<void> {
    const limit = await this.limit();
    while (this.holders.size < limit) {
      const next = this.waiting.shift();
      if (next === undefined) return;
      this.holders.add(next.taskId);
      next.resolve();
    }
  }

  holds(taskId: string): boolean {
    return this.holders.has(taskId);
  }

  private async limit(): Promise<number> {
    return (await this.settings.read()).runEnvironmentsAtOnce;
  }
}
