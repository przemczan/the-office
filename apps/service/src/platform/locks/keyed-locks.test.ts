import { describe, expect, it } from "vitest";
import { KeyedLocks } from "./keyed-locks.js";

describe("KeyedLocks", () => {
  it("runs work inside work holding the key at once", async () => {
    const locks = new KeyedLocks();
    const order: string[] = [];
    await locks.run("device", async () => {
      await locks.run("device", async () => {
        order.push("inner");
      });
      order.push("outer");
    });
    expect(order).toEqual(["inner", "outer"]);
  });

  it("queues a callback set up under the lock and fired later, once it runs detached", async () => {
    const locks = new KeyedLocks();
    const order: string[] = [];
    let fire!: () => void;
    const fired = new Promise<void>((resolve) => (fire = resolve));
    let callbackDone!: Promise<void>;
    let releaseHolder!: () => void;
    const holderReleased = new Promise<void>((resolve) => (releaseHolder = resolve));

    await locks.run("device", async () => {
      // As a helper's end: set up under the lock, fired once the lock is free.
      callbackDone = fired.then(() =>
        locks.runDetached("device", async () => {
          order.push("callback");
        }),
      );
    });
    const holder = locks.run("device", async () => {
      fire();
      await holderReleased;
      order.push("holder");
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual([]);
    releaseHolder();
    await Promise.all([holder, callbackDone]);
    expect(order).toEqual(["holder", "callback"]);
  });

  it("runs work holding every key, after work holding any of them, and holds them throughout", async () => {
    const locks = new KeyedLocks();
    const order: string[] = [];
    let releaseB!: () => void;
    const bReleased = new Promise<void>((resolve) => (releaseB = resolve));
    const holdingB = locks.run("b", async () => {
      await bReleased;
      order.push("b");
    });

    const holdingAll = locks.runAll(["c", "b", "a", "b"], async () => {
      order.push("all");
      await locks.run("a", () => {
        order.push("a inside");
        return Promise.resolve();
      });
    });
    const waitingForA = locks.run("a", () => {
      order.push("a after");
      return Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual([]);
    releaseB();
    await Promise.all([holdingB, holdingAll, waitingForA]);

    expect(order).toEqual(["b", "all", "a inside", "a after"]);
  });

  it("runs work at once with no key to hold", async () => {
    const locks = new KeyedLocks();

    await expect(locks.runAll([], () => Promise.resolve("ran"))).resolves.toBe("ran");
  });
});
