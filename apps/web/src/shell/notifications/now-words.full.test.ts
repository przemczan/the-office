import { describe, expect, it } from "vitest";
import {
  desksWords,
  fiveHourWindowName,
  inStageWords,
  namedUsageWindows,
  needsYouWords,
  resetMomentWords,
  sinceWords,
  usageFigureLabel,
  usageFigureWords,
  usageTone,
  type NamedUsageWindows,
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

const named = (engineName: string, percentUsed: number): NamedUsageWindows => ({
  ...reading(engineName, percentUsed),
  engineName,
});
const percents = (windows: readonly NamedUsageWindows[]) =>
  usageFigureWords(windows)?.readings.map(({ engineName, percent }) => [engineName, percent]);

describe("usageTone", () => {
  it("is calm under 90%, nearly used from 90%, where Window nearly used is raised, and used up at 100%", () => {
    expect([0, 89.9, 90, 99.9, 100, 104].map((percentUsed) => usageTone({ percentUsed }))).toEqual([
      "calm",
      "calm",
      "nearly-used",
      "nearly-used",
      "used-up",
      "used-up",
    ]);
  });
});

describe("usageFigureWords", () => {
  it("shows nothing until an engine is read", () => {
    expect(usageFigureWords([])).toBeUndefined();
  });

  it("shows one engine's 5-hour window, rounded, its reset, and its 7-day window after it", () => {
    const resetsAt = new Date(2026, 9, 27, 16, 40).toISOString();
    const figure = usageFigureWords([
      { ...named("Home", 41.6), fiveHour: { percentUsed: 41.6, resetsAt } },
    ]);

    expect(figure).toEqual({
      shows: "one",
      detail: "resets 16:40",
      readings: [{ engineName: "Home", percent: "42%", filled: 41.6, tone: "calm" }],
      after: "7d 17%",
    });
  });

  it("says until when one engine's window is used up, its meter full", () => {
    const resetsAt = new Date(2026, 9, 27, 14, 20).toISOString();
    const figure = usageFigureWords([
      { ...named("Home", 104), fiveHour: { percentUsed: 104, resetsAt } },
    ]);

    expect(figure?.detail).toBe("used up until 14:20");
    expect(figure?.readings[0]).toMatchObject({ filled: 100, tone: "used-up" });
  });

  it("shows two or three engines' 5-hour windows in their order, each with its tone", () => {
    const figure = usageFigureWords([named("Home", 42), named("Work", 91), named("Spare", 12)]);

    expect(figure?.shows).toBe("each");
    expect(figure?.detail).toBe("3 engines");
    expect(figure?.after).toBeUndefined();
    expect(figure?.readings.map(({ percent, tone }) => [percent, tone])).toEqual([
      ["42%", "calm"],
      ["91%", "nearly-used"],
      ["12%", "calm"],
    ]);
    expect(percents([named("Home", 42), named("Work", 80)])).toEqual([
      ["Home", "42%"],
      ["Work", "80%"],
    ]);
  });

  it("shows the highest 5-hour window and the count from four engines", () => {
    const windows = [10, 80, 30, 20, 79.4].map((percent, index) => named(`E${index}`, percent));
    const figure = usageFigureWords(windows);

    expect(figure).toMatchObject({ shows: "highest", detail: "5 engines", after: "highest" });
    expect(percents(windows)).toEqual([["E1", "80%"]]);
    expect(usageFigureWords(windows.slice(0, 4))?.detail).toBe("4 engines");
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
