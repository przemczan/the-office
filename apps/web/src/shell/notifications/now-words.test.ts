import type { FinishedTask, TaskOutcome } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  desksWords,
  doneSinceYouLeft,
  fiveHourWindowName,
  inStageWords,
  namedUsageWindows,
  needsYouWords,
  resetMomentWords,
  sinceWords,
  usageFigureLabel,
  usageFigureWords,
  type NamedUsageWindows,
  type UsageFigurePart,
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

describe("resetMomentWords", () => {
  const now = new Date(2026, 9, 27, 9, 30);

  it("shows the clock for a reset today, and the day for one on another", () => {
    expect(resetMomentWords(new Date(2026, 9, 27, 14, 20).toISOString(), now)).toBe("resets 14:20");
    expect(resetMomentWords(new Date(2026, 9, 30, 9, 0).toISOString(), now)).toBe(
      "resets 30 Oct, 09:00",
    );
  });

  it("says nothing while the window has not begun", () => {
    expect(resetMomentWords(null, now)).toBeUndefined();
  });
});

const reading = (engineId: string, percentUsed: number) => ({
  engineId,
  fiveHour: { percentUsed, resetsAt: null },
  sevenDay: { percentUsed: 17, resetsAt: null },
});

describe("namedUsageWindows", () => {
  const engines = [
    { id: "home", name: "Home account" },
    { id: "work", name: "Work account" },
  ];

  it("names each window and orders them as the engines are listed, an unlisted one last", () => {
    const named = namedUsageWindows(
      [reading("removed", 5), reading("work", 40), reading("home", 70)],
      engines,
    );
    expect(named.map(({ engineName, fiveHour }) => [engineName, fiveHour.percentUsed])).toEqual([
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

  it("leaves out an engine with no windows read, such as the OpenAI-compatible API", () => {
    expect(namedUsageWindows([], engines)).toEqual([]);
    expect(
      namedUsageWindows([reading("work", 40)], engines).map(({ engineId }) => engineId),
    ).toEqual(["work"]);
  });
});

describe("usageFigureWords", () => {
  const named = (engineName: string, percentUsed: number): NamedUsageWindows => ({
    ...reading(engineName, percentUsed),
    engineName,
  });
  const shown = (parts: readonly UsageFigurePart[]): string =>
    parts
      .map(({ before, figure, after }) => [before, figure, after].filter(Boolean).join(" "))
      .join(" · ");

  it("shows nothing until an engine is read", () => {
    expect(usageFigureWords([])).toEqual([]);
  });

  it("shows one engine's two windows, rounded", () => {
    expect(shown(usageFigureWords([named("Home", 41.6)]))).toBe("5h 42% · 7d 17%");
  });

  it("shows two or three engines' 5-hour windows in their order, each by its engine", () => {
    const parts = usageFigureWords([named("Home", 42), named("Work", 80), named("Spare", 12)]);

    expect(shown(parts)).toBe("5h 42% · 80% · 12%");
    expect(parts.map(({ engineName }) => engineName)).toEqual(["Home", "Work", "Spare"]);
    expect(shown(usageFigureWords([named("Home", 42), named("Work", 80)]))).toBe("5h 42% · 80%");
  });

  it("shows the highest 5-hour window and a count from four engines", () => {
    const windows = [10, 80, 30, 20, 79.4].map((percent, index) => named(`E${index}`, percent));

    expect(shown(usageFigureWords(windows))).toBe("5h 80% max · 5 engines");
    expect(shown(usageFigureWords(windows.slice(0, 4)))).toBe("5h 80% max · 4 engines");
  });
});

describe("usageFigureLabel", () => {
  it("names every engine's 5-hour window", () => {
    const windows = [
      { ...reading("home", 42), engineName: "Home account" },
      { ...reading("work", 80), engineName: "Work account" },
    ];

    expect(usageFigureLabel(windows)).toBe("5-hour window: Home account 42%, Work account 80%");
  });
});
