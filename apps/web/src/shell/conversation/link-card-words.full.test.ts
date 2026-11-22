import type { RunningTask, TaskState } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { personStatus } from "./link-card-words.ts";

function aRunningTask(title: string, role: string, state: TaskState = "in-progress"): RunningTask {
  return {
    taskId: crypto.randomUUID(),
    title,
    projectId: "lightnet-mobile",
    state,
    pausedBy: null,
    resumesAt: null,
    stage: { key: "implement", name: "Implement", role, since: "2026-10-27T09:00:00.000Z" },
    madeFor: null,
  };
}

describe("personStatus", () => {
  it("is available when the person works no running Task's Stage", () => {
    expect(personStatus("devops", [aRunningTask("Rename dialog", "developer")])).toBe("Available");
  });

  it("names the Stage and the Task, or that it waits on the user or is paused", () => {
    expect(personStatus("devops", [aRunningTask("Build cache", "devops")])).toBe(
      "Implement · Build cache",
    );
    expect(personStatus("devops", [aRunningTask("Build cache", "devops", "waiting-on-you")])).toBe(
      "Waiting on you · Build cache",
    );
    expect(personStatus("devops", [aRunningTask("Build cache", "devops", "paused")])).toBe(
      "Paused · Build cache",
    );
  });

  it("counts several Tasks, and how many of them wait on the user", () => {
    const running = [
      aRunningTask("Build cache", "devops"),
      aRunningTask("Toolchain", "devops", "waiting-on-you"),
    ];

    expect(personStatus("devops", running)).toBe("2 Tasks · 1 waiting on you");
    expect(personStatus("devops", running.slice(0, 1).concat(running.slice(0, 1)))).toBe("2 Tasks");
  });
});
