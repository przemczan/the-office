import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import { overlapsOf, overlapWords } from "./task-overlap.js";
import { aTask } from "./work.fixtures.js";

const STARTING = aTask({
  id: "starting",
  state: "ready",
  filesToChange: ["src/auth", "README.md"],
});

function started(id: string, filesToChange: readonly string[], fields: Partial<Task> = {}): Task {
  return aTask({ id, title: `Task ${id}`, state: "in-progress", filesToChange, ...fields });
}

describe("overlapsOf", () => {
  it("names each started Task of the Project expecting to change some of the same files", () => {
    const tasks = [
      started("a", ["README.md", "docs"]),
      started("b", ["src/auth/login.ts", "src/main.ts"], { state: "waiting-on-you" }),
      started("c", ["src/billing"], { state: "paused" }),
    ];

    expect(overlapsOf(STARTING, tasks)).toEqual([
      { taskId: "a", title: "Task a", files: ["README.md"] },
      { taskId: "b", title: "Task b", files: ["src/auth/login.ts"] },
    ]);
  });

  it("has a folder cover the files under it, but not a sibling that only starts alike", () => {
    const task = aTask({ id: "starting", state: "ready", filesToChange: ["src/auth/login.ts"] });

    expect(overlapsOf(task, [started("a", ["src/auth"])])).toEqual([
      { taskId: "a", title: "Task a", files: ["src/auth/login.ts"] },
    ]);
    expect(overlapsOf(task, [started("b", ["src/au", "src/auth/login.tsx"])])).toEqual([]);
  });

  it("weighs only started Tasks of the same Project, never the Task itself", () => {
    const tasks = [
      started("other-project", ["src/auth"], { projectId: "project-2" }),
      started("ready", ["src/auth"], { state: "ready" }),
      started("done", ["src/auth"], { state: "done" }),
      { ...STARTING, state: "in-progress" as const },
    ];

    expect(overlapsOf(STARTING, tasks)).toEqual([]);
  });

  it("finds none for a Plan with no files to change", () => {
    const task = aTask({ id: "starting", state: "ready", filesToChange: [] });

    expect(overlapsOf(task, [started("a", ["src"])])).toEqual([]);
  });
});

describe("overlapWords", () => {
  it("names the Task and the files, and what Start offers", () => {
    expect(overlapWords({ taskId: "a", title: "Login", files: ["src/a.ts", "src/b.ts"] })).toBe(
      '"Login" is in progress and expects to change src/a.ts, src/b.ts too: start anyway, or queue behind it.',
    );
  });
});
