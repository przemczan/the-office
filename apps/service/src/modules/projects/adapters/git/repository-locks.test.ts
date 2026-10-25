import { describe, expect, it } from "vitest";
import { RepositoryLocks } from "./repository-locks.js";

/** Work that runs until the test lets it finish, recording when it started and finished. */
function controlledWork(name: string, log: string[]) {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  return {
    finish,
    work: async () => {
      log.push(`${name} started`);
      await finished;
      log.push(`${name} finished`);
      return name;
    },
  };
}

/** Lets every queued promise callback run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("RepositoryLocks", () => {
  it("runs work on one repository one at a time, in arrival order", async () => {
    const locks = new RepositoryLocks();
    const log: string[] = [];
    const first = controlledWork("first", log);
    const second = controlledWork("second", log);
    const third = controlledWork("third", log);

    const results = [first, second, third].map(({ work }) => locks.run("/repository/.git", work));
    await settle();
    expect(log).toEqual(["first started"]);

    third.finish();
    second.finish();
    first.finish();

    await expect(Promise.all(results)).resolves.toEqual(["first", "second", "third"]);
    expect(log).toEqual([
      "first started",
      "first finished",
      "second started",
      "second finished",
      "third started",
      "third finished",
    ]);
  });

  it("runs work on different repositories at the same time", async () => {
    const locks = new RepositoryLocks();
    const log: string[] = [];
    const one = controlledWork("one", log);
    const other = controlledWork("other", log);

    const results = [locks.run("/one/.git", one.work), locks.run("/other/.git", other.work)];
    await settle();
    expect(log).toEqual(["one started", "other started"]);

    one.finish();
    other.finish();
    await Promise.all(results);
  });

  it("goes on with the next work after one fails", async () => {
    const locks = new RepositoryLocks();
    const failing = locks.run("/repository/.git", () => Promise.reject(new Error("refused")));
    const next = locks.run("/repository/.git", () => Promise.resolve("ran"));

    await expect(failing).rejects.toThrow("refused");
    await expect(next).resolves.toBe("ran");
  });
});
