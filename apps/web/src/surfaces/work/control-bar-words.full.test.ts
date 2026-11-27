import type { TaskSummary } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { initiativeBarWords, taskBarWords } from "./control-bar-words.ts";

function tasksIn(...states: TaskSummary["state"][]): Pick<TaskSummary, "state">[] {
  return states.map((state) => ({ state }));
}

const ACTIVE = { state: "active", pausedAt: null } as const;

describe("initiativeBarWords", () => {
  it("counts what waits in an active Initiative, each count only when it has any", () => {
    expect(initiativeBarWords(ACTIVE, tasksIn("ready", "backlog", "backlog"), {}).words).toBe(
      "1 Task is Ready to start, and 2 Tasks wait in Backlog for a Plan.",
    );
    expect(initiativeBarWords(ACTIVE, tasksIn("ready", "ready"), {}).words).toBe(
      "2 Tasks are Ready to start.",
    );
    expect(initiativeBarWords(ACTIVE, tasksIn("backlog", "in-progress"), {}).words).toBe(
      "1 Task waits in Backlog for a Plan.",
    );
    expect(initiativeBarWords(ACTIVE, tasksIn("in-progress"), {}).words).toBe(
      "Its Tasks are on their way.",
    );
  });

  it("counts a Done Initiative's Tasks, leaving out its Dropped ones", () => {
    const words = initiativeBarWords(
      { state: "done", pausedAt: null },
      tasksIn("done", "dropped"),
      {},
    );
    expect(words.words).toBe("1 of 1 Task done.");
  });
});

describe("taskBarWords", () => {
  it("names a Decision or a Gate while the Task waits on the user", () => {
    expect(taskBarWords({ state: "waiting-on-you", pausedBy: null }, {}).words).toBe(
      "A Decision or a Gate needs you; Pause or Stop hold it meanwhile.",
    );
  });
});
