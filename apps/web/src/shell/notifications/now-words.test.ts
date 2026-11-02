import type { FinishedTask, TaskOutcome } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  desksWords,
  doneSinceYouLeft,
  fiveHourWindowName,
  inStageWords,
  namedFiveHourWindows,
  needsYouWords,
  sinceWords,
} from "./now-words.ts";

describe("needsYouWords", () => {
  it("agrees with the count", () => {
    expect([1, 3].map(needsYouWords)).toEqual(["needs you", "need you"]);
  });
});

describe("desksWords", () => {
  it("counts the running Tasks against the Office-wide limit", () => {
    expect(desksWords({ desks: { inUse: 2, limit: 3 } })).toBe("2 of 3 desks");
  });
});

describe("sinceWords", () => {
  const now = new Date(2026, 9, 27, 9, 30);

  it("shows the clock when the user left today, and the day before", () => {
    expect(sinceWords(new Date(2026, 9, 27, 8, 5).toISOString(), now)).toBe("since 08:05");
    expect(sinceWords(new Date(2026, 9, 26, 22, 0).toISOString(), now)).toBe("since 26 Oct, 22:00");
  });

  it("says nothing until the user is first seen", () => {
    expect(sinceWords(null, now)).toBeUndefined();
  });
});

describe("inStageWords", () => {
  it("counts from the Stage's latest run", () => {
    const stage = { key: "build", name: "Build", role: "developer", since: "2026-10-27T09:00:00Z" };

    expect(inStageWords(stage, new Date("2026-10-27T09:18:10Z"))).toBe("18 min in Stage");
  });
});

function finished(outcome: TaskOutcome): FinishedTask {
  return {
    taskId: crypto.randomUUID(),
    title: "A Task",
    projectId: "p1",
    outcome,
    occurredAt: "2026-10-27T09:00:00Z",
  };
}

describe("doneSinceYouLeft", () => {
  it("counts only the Done outcomes", () => {
    expect(
      doneSinceYouLeft({ sinceYouLeft: [finished("done"), finished("failed"), finished("done")] }),
    ).toBe(2);
  });
});

const reading = (engineId: string, percentUsed: number) => ({
  engineId,
  percentUsed,
  resetsAt: null,
});

describe("namedFiveHourWindows", () => {
  const engines = [
    { id: "home", name: "Home account" },
    { id: "work", name: "Work account" },
  ];

  it("names each window and orders them as the engines are listed, an unlisted one last", () => {
    const named = namedFiveHourWindows(
      [reading("removed", 5), reading("work", 40), reading("home", 70)],
      engines,
    );
    expect(named.map(({ engineName, percentUsed }) => [engineName, percentUsed])).toEqual([
      ["Home account", 70],
      ["Work account", 40],
      ["removed", 5],
    ]);
    expect(named.map(fiveHourWindowName)).toEqual([
      "Home account's 5-hour window",
      "Work account's 5-hour window",
      "removed's 5-hour window",
    ]);
  });

  it("leaves out an engine not read yet", () => {
    expect(namedFiveHourWindows([], engines)).toEqual([]);
  });
});
