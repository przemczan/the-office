import type { BasicStats, StatsDay, TelemetrySettings } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { closePage, openPage, stubService, until } from "../../shell/page.fixtures.tsx";
import { PROJECT_FILTER_STORAGE_KEY } from "../../shell/project-filter/project-filter-store.ts";
import { StatsPage } from "./stats-page.tsx";

// jsdom has no layout, so a day's Tooltip never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

/** 30 office days ending 17 Nov: 11.99M on the first, 410k counted today with 5M cache reads. */
const DAYS: StatsDay[] = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 9, 19 + index));
  const day = date.toISOString().slice(0, 10);
  if (index === 0) return { day, tokens: { ...ZERO, input: 11_990_000 } };
  if (index === 29) {
    return {
      day,
      tokens: { input: 300_000, output: 100_000, cacheCreation: 10_000, cacheRead: 5_000_000 },
    };
  }
  return { day, tokens: ZERO };
});

const TASK_ID = "3f2a1b0c-4d5e-4f6a-8b7c-9d0e1f2a3b4c";

const STATS: BasicStats = {
  days: DAYS,
  // Noon, so the day reads 16 Nov in any time zone the tests run in.
  weekStartsAt: "2026-11-16T12:00:00.000Z",
  topTasks: [
    { taskId: TASK_ID, title: "Add a filter", projectId: "p1", tokens: 820_000 },
    {
      taskId: "4a3b2c1d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      title: "Fix the header",
      projectId: "p2",
      tokens: 410_000,
    },
  ],
  tasksDone: 7,
  stageRetries: 3,
  engines: [
    {
      engineId: "work",
      name: "Work account",
      windows: {
        state: "read",
        fiveHour: { percentUsed: 41, resetsAt: "2026-11-17T14:00:00.000Z" },
        sevenDay: { percentUsed: 92, resetsAt: "2026-11-23T09:00:00.000Z" },
        readAt: "2026-11-17T10:00:00.000Z",
      },
    },
    { engineId: "home", name: "Home account", windows: { state: "not-read" } },
    { engineId: "api", name: "Codex on an API key", windows: { state: "none" } },
  ],
};

const OFF: TelemetrySettings = {
  saved: { kind: "off" },
  running: { kind: "off" },
  setByEnvironment: false,
  appliesAtNextStart: false,
  bundledGrafana: { state: "not-wanted", address: "http://localhost:3300", earlierStopped: [] },
};

const pages = { stats: StatsPage };

function openStats(
  stats: BasicStats = STATS,
  telemetry: TelemetrySettings = OFF,
  path = "GET /api/stats/basic",
) {
  const sent = stubService({
    [path]: () => ({ status: 200, body: stats }),
    "GET /api/settings/telemetry": () => ({ status: 200, body: telemetry }),
    "GET /api/stats/full?range=7d&split=model": () => ({
      status: 200,
      body: { state: "not-on" },
    }),
  });
  return { sent, opened: openPage("/stats", pages) };
}

function block(page: HTMLElement, heading: string): HTMLElement {
  const found = [...page.querySelectorAll<HTMLElement>("section[aria-labelledby]")].find(
    (section) => section.querySelector("h3")?.textContent === heading,
  );
  if (!found) throw new Error(`No block ${heading}.`);
  return found;
}

afterEach(closePage);

describe("Stats", () => {
  it("shows the basic stats' blocks, reading them from the service", async () => {
    const { sent, opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));

    expect(page.querySelector("h2")?.textContent).toBe("Stats");
    for (const heading of [
      "Tokens per day",
      "Usage windows now",
      "The Tasks with the most tokens this week",
      "This week",
    ]) {
      expect(block(page, heading)).toBeDefined();
    }
    expect(block(page, "Tokens per day").textContent).toContain("Office-wide");
    expect(block(page, "Usage windows now").textContent).toContain("Office-wide");
    expect(block(page, "This week").textContent).toContain("since Mon 16 Nov");
    expect(block(page, "This week").textContent).toContain("Tasks done7");
    expect(block(page, "This week").textContent).toContain("Stage retries3");
    expect(sent.map(({ request }) => request)).toContain("GET /api/stats/basic");
  });

  it("leaves cache reads out of every total, drawing them apart", async () => {
    const { opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Tokens per day"));
    const days = block(page, "Tokens per day");

    expect(days.querySelector(".stats-figure")?.textContent).toContain("12.4M tokens in 30 days");
    expect(days.querySelector(".stats-figure")?.textContent).toContain("410k today");
    expect(days.textContent).toContain("Cache reads, not counted · 5M in 30 days");

    const chart = days.querySelector<HTMLElement>("[role='img']");
    act(() => chart?.focus());
    const tip = document.body.querySelector(".stats-tip");
    expect(tip?.textContent).toContain("Tue 17 Nov · today");
    expect(tip?.textContent).toContain("Total410k");
    expect(tip?.textContent).toContain("Cache reads, not counted5M");
  });

  it("gives the days as a table", async () => {
    const { opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Show as a table"));
    const toggle = [...page.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Show as a table"),
    );
    act(() => toggle?.click());

    const rows = [...block(page, "Tokens per day").querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(30);
    expect(rows.at(-1)?.textContent).toContain("410k");
    expect(page.textContent).toContain("Show as a chart");
  });

  it("links each top Task to its page, with a bar against the first", async () => {
    const { opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));
    const top = block(page, "The Tasks with the most tokens this week");

    const link = [...top.querySelectorAll("a")].find((each) => each.textContent === "Add a filter");
    expect(link?.getAttribute("href")).toBe(`/tasks/${TASK_ID}`);
    const bars = [...top.querySelectorAll<HTMLElement>(".stats-bar-track i")];
    expect(bars.map((bar) => bar.style.width)).toEqual(["100%", "50%"]);
    expect(top.textContent).toContain("Stage runs only");
  });

  it("says what fills the empty blocks", async () => {
    const { opened } = openStats({ ...STATS, topTasks: [], engines: [] });
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("No Stage has run this week yet."));
    expect(page.textContent).toContain("None of your engines has Usage windows.");
  });

  it("shows each engine's windows, not yet read ones as such, and leaves out those without", async () => {
    const { opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Work account"));
    const windows = block(page, "Usage windows now");

    expect(windows.textContent).toContain("41% · resets");
    const meters = [...windows.querySelectorAll<HTMLElement>("[role='meter']")];
    expect(meters.map((meter) => meter.dataset["tone"])).toEqual(["calm", "nearly-used"]);
    expect(windows.textContent).toContain("Home account");
    expect(windows.textContent).toContain("Not read yet");
    expect(windows.textContent).not.toContain("Codex on an API key");
  });

  it.each([
    [OFF, "Turn on Grafana in Settings › Telemetry to see more.", "Settings › Telemetry"],
    [
      {
        ...OFF,
        saved: { kind: "own-endpoint", endpoint: "https://otel.example.com", headerNames: [] },
      } satisfies TelemetrySettings,
      "Add your Grafana's read address in Settings › Telemetry to see more.",
      "Settings › Telemetry",
    ],
    [
      { ...OFF, setByEnvironment: true },
      "The environment sets telemetry, so Stats shows the basic stats only.",
      "Remove the OTEL_ variables to choose in Settings › Telemetry",
    ],
  ])("shows the message for the telemetry chosen", async (telemetry, words, step) => {
    const { opened } = openStats(STATS, telemetry);
    const { page } = await opened;
    await until(() => expect(page.querySelector("[aria-label='The full stats']")).not.toBeNull());
    const message = page.querySelector("[aria-label='The full stats']");

    expect(message?.textContent).toContain(words);
    expect(message?.textContent).toContain("Estimated cost by model, Role, Stage, Pipeline");
    expect(message?.querySelector("a")?.getAttribute("href")).toBe("/settings/telemetry");
    expect(message?.textContent).toContain(step);
  });

  it.each([
    ["Bundled Grafana", { ...OFF, saved: { kind: "bundled-grafana" } } satisfies TelemetrySettings],
    [
      "an own endpoint with a Grafana read address",
      {
        ...OFF,
        saved: {
          kind: "own-endpoint",
          endpoint: "https://otel.example.com",
          headerNames: [],
          grafana: { readAddress: "https://grafana.example.com", hasReadToken: true },
        },
      } satisfies TelemetrySettings,
    ],
  ])("shows no message with %s chosen and no answer from it", async (_chosen, telemetry) => {
    const { opened } = openStats(STATS, telemetry);
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));
    await until(() => expect(page.textContent).toContain("Tasks done"));
    expect(page.querySelector("[aria-label='The full stats']")).toBeNull();
  });
});

describe("Stats under a Project filter", () => {
  afterEach(() => {
    localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });
  });

  it("names each Project shown, and says the Office-wide blocks aren't narrowed", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["p1", "p2"]));
    const { sent, opened } = openStats(STATS, OFF, "GET /api/stats/basic?project=p1&project=p2");
    const { page } = await opened;
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    await until(() => expect(page.textContent).toContain("Add a filter"));
    expect(sent.map(({ request }) => request)).toContain(
      "GET /api/stats/basic?project=p1&project=p2",
    );
    expect(block(page, "Tokens per day").textContent).toContain(
      "The Project filter doesn't narrow this: these figures belong to The Office as a whole.",
    );
  });
});
