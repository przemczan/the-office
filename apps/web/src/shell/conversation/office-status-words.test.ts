import type { NeedsYouItem, RunningTask, TaskState } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { pausedWords, waitingWords } from "./office-status-words.ts";

const SINCE = "2026-10-27T09:00:00.000Z";

function aDecision(): NeedsYouItem {
  const taskId = crypto.randomUUID();
  return { kind: "decision", decisionId: crypto.randomUUID(), taskId, waitingSince: SINCE };
}

function aGate(): NeedsYouItem {
  return { kind: "gate", taskId: crypto.randomUUID(), stageKey: "review", waitingSince: SINCE };
}

function aRunningTask(state: TaskState): RunningTask {
  return { taskId: crypto.randomUUID(), title: "Build cache", projectId: "p1", state, stage: null };
}

describe("waitingWords", () => {
  it("counts the Decisions and Gates that wait on the user", () => {
    expect(waitingWords([aDecision(), aGate(), aGate()])).toBe(
      "Waiting on you: 1 Decision, 2 Gates",
    );
    expect(waitingWords([aGate()])).toBe("Waiting on you: 1 Gate");
  });

  it("says when nothing waits", () => {
    expect(waitingWords([])).toBe("Nothing waits on you.");
  });
});

describe("pausedWords", () => {
  it("counts the paused Tasks, and is undefined with none", () => {
    expect(pausedWords([aRunningTask("paused"), aRunningTask("in-progress")])).toBe(
      "Paused: 1 Task",
    );
    expect(pausedWords([aRunningTask("waiting-on-you")])).toBeUndefined();
  });
});
