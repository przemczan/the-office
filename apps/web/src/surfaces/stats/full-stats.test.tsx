import type {
  BasicStats,
  FullStats,
  FullStatsRead,
  Project,
  TelemetrySettings,
} from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { statsQueries } from "../../api/telemetry.ts";
import {
  closePage,
  openPage,
  stubService,
  until,
  type Answers,
} from "../../shell/page.fixtures.tsx";
import { PROJECT_FILTER_STORAGE_KEY } from "../../shell/project-filter/project-filter-store.ts";
import { PageHeadingProvider } from "../../shell/page-heading.tsx";
import { StatsPage } from "./stats-page.tsx";
import { stretchWords } from "./stats-words.ts";

// jsdom has no layout, so a Tooltip never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

const BASIC: BasicStats = {
  days: Array.from({ length: 30 }, (_, index) => ({
    day: new Date(Date.UTC(2026, 9, 19 + index)).toISOString().slice(0, 10),
    tokens: ZERO,
  })),
  weekStartsAt: "2026-11-16T12:00:00.000Z",
  topTasks: [
    {
      taskId: "4a3b2c1d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      title: "Basic top",
      projectId: "p1",
      tokens: 10,
    },
  ],
  tasksDone: 4,
  stageRetries: 2,
  engines: [
    {
      engineId: "work",
      name: "Work account",
      windows: {
        state: "read",
        fiveHour: { percentUsed: 41, resetsAt: "2026-11-17T14:00:00.000Z" },
        sevenDay: { percentUsed: 62, resetsAt: "2026-11-23T09:00:00.000Z" },
        readAt: "2026-11-17T10:00:00.000Z",
      },
    },
  ],
};

const BUNDLED: TelemetrySettings = {
  saved: { kind: "bundled-grafana" },
  running: { kind: "off" },
  setByEnvironment: false,
  appliesAtNextStart: false,
  bundledGrafana: { state: "running", address: "http://127.0.0.1:3300", earlierStopped: [] },
};

const PROJECTS: Project[] = [];

const TASK_ID = "3f2a1b0c-4d5e-4f6a-8b7c-9d0e1f2a3b4c";
const OTHER_TASK_ID = "5b4c3d2e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const INITIATIVE_ID = "6c5d4e3f-7a8b-4c9d-8e0f-2a3b4c5d6e7f";

/** Seven office days, noon-free so each reads its own day in any time zone near UTC. */
const DAYS = Array.from({ length: 7 }, (_, index) =>
  new Date(Date.UTC(2026, 10, 11 + index, 12)).toISOString(),
);

const FULL: FullStatsRead = {
  state: "full",
  address: "http://127.0.0.1:3300",
  range: "7d",
  split: "model",
  from: "2026-11-11T00:00:00.000Z",
  to: "2026-11-18T00:00:00.000Z",
  usage: DAYS.map((at, index) => ({
    at,
    groups:
      index === 6
        ? [
            { name: "claude-sonnet", tokens: 3_200_000, estimatedCostUsd: 30 },
            { name: "", tokens: 1_000_000, estimatedCostUsd: 8.1 },
          ]
        : [],
  })),
  costliestTasks: [
    {
      taskId: TASK_ID,
      title: "Add a filter",
      projectId: "p1",
      tokens: 900_000,
      estimatedCostUsd: 5,
      stages: [
        {
          stageName: "Implement",
          tries: [
            { try: 1, tokens: 300_000, estimatedCostUsd: 1.2 },
            { try: 2, tokens: 200_000, estimatedCostUsd: 0.9 },
          ],
        },
        { stageName: "Review", tries: [{ try: 1, tokens: 100_000, estimatedCostUsd: 0.4 }] },
      ],
      outsideStages: { tokens: 300_000, estimatedCostUsd: 2.5 },
    },
    {
      taskId: OTHER_TASK_ID,
      title: "Fix the header",
      projectId: "p1",
      tokens: 400_000,
      estimatedCostUsd: 2.5,
      stages: [],
      outsideStages: { tokens: 0, estimatedCostUsd: 0 },
    },
  ],
  costliestInitiatives: [
    {
      initiativeId: INITIATIVE_ID,
      title: "Statistics",
      projectIds: ["p1"],
      tokens: 1_300_000,
      estimatedCostUsd: 9,
      tasks: [{ taskId: TASK_ID, title: "Add a filter", tokens: 900_000, estimatedCostUsd: 5 }],
      ownThreads: { tokens: 100_000, estimatedCostUsd: 1.5 },
    },
  ],
  windows: [
    {
      engineId: "home",
      name: "Home account",
      fiveHour: [{ at: DAYS[6] ?? "", percentUsed: 20 }],
      sevenDay: [{ at: DAYS[6] ?? "", percentUsed: 30 }],
    },
    {
      engineId: "work",
      name: "Work account",
      fiveHour: DAYS.map((at, index) => ({ at, percentUsed: 10 * index })),
      sevenDay: DAYS.map((at, index) => ({ at, percentUsed: 5 * index })),
    },
  ],
  running: [
    {
      engineId: "work",
      taskId: TASK_ID,
      title: "Add a filter",
      projectId: "p1",
      stageName: "Implement",
      startedAt: "2026-11-16T10:00:00.000Z",
      endedAt: "2026-11-16T11:00:00.000Z",
    },
  ],
};

const FULL_PATH = "GET /api/stats/full?range=7d&split=model";

const pages = {
  stats: () => (
    <PageHeadingProvider setPageHeading={() => undefined}>
      <StatsPage />
    </PageHeadingProvider>
  ),
};

function openStats(
  full: FullStats | ((path: string) => FullStats) = FULL,
  extra: Answers = {},
  { holdFull = false }: { readonly holdFull?: boolean } = {},
) {
  const answer =
    (path: string): Answers[string] =>
    () => ({ status: 200, body: typeof full === "function" ? full(path) : full });
  const answers: Answers = {
    "GET /api/stats/basic": () => ({ status: 200, body: BASIC }),
    "GET /api/settings/telemetry": () => ({ status: 200, body: BUNDLED }),
    "GET /api/projects": () => ({ status: 200, body: PROJECTS }),
    ...extra,
  };
  for (const range of ["24h", "7d", "30d"]) {
    for (const split of ["model", "role", "stage", "pipeline", "project"]) {
      const path = `GET /api/stats/full?range=${range}&split=${split}`;
      answers[path] ??= answer(path);
    }
  }
  const sent = stubService(answers);
  if (holdFull) {
    // The full stats never answer, as while Grafana is read.
    const answering = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/stats/full")
        ? new Promise<Response>(() => {})
        : answering(input, init),
    );
  }
  return { sent, opened: openPage("/stats", pages) };
}

function block(page: HTMLElement, heading: string): HTMLElement {
  const found = [...page.querySelectorAll<HTMLElement>("section[aria-labelledby]")].find(
    (section) => section.querySelector("h3")?.textContent === heading,
  );
  if (!found) throw new Error(`No block ${heading}.`);
  return found;
}

function headings(page: HTMLElement): string[] {
  return [...page.querySelectorAll("section[aria-labelledby] h3")].map(
    (heading) => heading.textContent ?? "",
  );
}

function tab(scope: HTMLElement, group: string, name: string): HTMLButtonElement {
  const found = scope
    .querySelector(`[role='group'][aria-label='${group}']`)
    ?.querySelectorAll<HTMLButtonElement>("[role='tab']");
  const shown = [...(found ?? [])].find((each) => each.textContent === name);
  if (!shown) throw new Error(`No tab ${name} in ${group}.`);
  return shown;
}

/** The button named `name`; never cloned, as the segmented controls' inline styles break jsdom. */
function button(scope: HTMLElement, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) =>
      (each.getAttribute("aria-label") ??
        [...each.childNodes]
          .filter((node) => node.nodeName !== "STYLE")
          .map((node) => node.textContent)
          .join("")
          .trim()) === name,
  );
  if (!found) throw new Error(`No button ${name}.`);
  return found;
}

afterEach(closePage);

describe("the full stats", () => {
  it("shows the full blocks in the design's order, under the range and the coverage line", async () => {
    const { sent, opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));

    expect(sent.map(({ request }) => request)).toContain(FULL_PATH);
    expect(headings(page)).toEqual([
      "Tokens and estimated cost over time",
      "The most expensive",
      "Usage windows over time",
      "Usage windows now",
      "This week",
    ]);
    expect(page.textContent).toContain(
      "The full stats cover what The Office has sent Grafana since it started sending it.",
    );
    expect(tab(page, "Range", "7 d").getAttribute("aria-selected")).toBe("true");
    expect(page.querySelector("[aria-label='The full stats']")).toBeNull();
    expect(page.textContent).not.toContain("Grafana is starting");
  });

  it("heads tokens and estimated cost over time with its totals, always calling cost estimated", async () => {
    const { opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));
    const usage = block(page, "Tokens and estimated cost over time");

    expect(usage.querySelector(".stats-figure")?.textContent).toBe(
      "4.2M tokens·$38.10 estimated·7 days",
    );
    // A group named "" by model is work with no model.
    expect(usage.querySelector(".stats-legend")?.textContent).toContain("claude-sonnet 3.2M");
    expect(usage.querySelector(".stats-legend")?.textContent).toContain("No model 1M");
    act(() => tab(usage, "Measure", "Estimated cost").click());
    expect(usage.querySelector(".stats-legend")?.textContent).toContain("claude-sonnet $30.00");

    const chart = usage.querySelector<HTMLElement>("[role='img']");
    act(() => chart?.focus());
    const tip = document.body.querySelector(".stats-tip");
    expect(tip?.textContent).toContain("· estimated");
    expect(tip?.textContent).toContain("Estimated cost$38.10");
  });

  it("asks for the split and the range picked, keeping the range in the address", async () => {
    const { sent, opened } = openStats((path) => ({
      ...FULL,
      split: path.includes("split=stage") ? "stage" : "model",
      range: path.includes("range=30d") ? "30d" : "7d",
    }));
    const { page, router } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));

    act(() => tab(page, "Split by", "Stage").click());
    await until(() =>
      expect(sent.map(({ request }) => request)).toContain(
        "GET /api/stats/full?range=7d&split=stage",
      ),
    );
    await until(() => expect(page.textContent).toContain("Not in a Stage 1M"));

    act(() => tab(page, "Range", "30 d").click());
    await until(() =>
      expect(sent.map(({ request }) => request)).toContain(
        "GET /api/stats/full?range=30d&split=stage",
      ),
    );
    expect(router.state.location.search).toEqual({ range: "30d" });
    await until(() => expect(page.textContent).toContain("in 30 days"));
  });

  it("gives tokens and estimated cost over time as a table", async () => {
    const { opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));
    const usage = block(page, "Tokens and estimated cost over time");

    act(() => button(usage, "Show as a table").click());
    const rows = [...usage.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(7);
    expect(rows.at(-1)?.textContent).toContain("4.2M");
    expect(usage.querySelector("thead")?.textContent).toContain("claude-sonnet");
  });

  it("links each of the most expensive Tasks to its page, opening to its cost per Stage and try", async () => {
    const { opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));
    const costliest = block(page, "The most expensive");

    const link = [...costliest.querySelectorAll("a")].find(
      (each) => each.textContent === "Add a filter",
    );
    expect(link?.getAttribute("href")).toBe(`/tasks/${TASK_ID}`);
    expect(costliest.textContent).toContain("3 Stage runs · 1 retry · Retries: $0.90, 18%");
    expect(costliest.textContent).toContain("$5.00");
    expect(costliest.textContent).toContain("Estimated cost");
    const bars = [...costliest.querySelectorAll<HTMLElement>(".stats-x-bar i")];
    expect(bars.map((bar) => bar.style.width)).toEqual(["100%", "50%"]);

    const fold = button(costliest, "Cost per Stage: Add a filter");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    act(() => fold.click());
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    const runs = [...costliest.querySelectorAll(".stats-run")].map((run) => run.textContent);
    expect(runs).toEqual(["Run 1 · $1.20", "Run 2 · retry · $0.90", "Run 1 · $0.40"]);
    expect(costliest.textContent).toContain("Outside a Stage$2.50");
  });

  it("lists the most expensive Initiatives, each with its Tasks and its own Threads", async () => {
    const { opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));
    const costliest = block(page, "The most expensive");

    act(() => tab(costliest, "Show", "Initiatives").click());
    const link = [...costliest.querySelectorAll("a")].find(
      (each) => each.textContent === "Statistics",
    );
    expect(link?.getAttribute("href")).toBe(`/work/initiatives/${INITIATIVE_ID}`);
    act(() => button(costliest, "Cost per Stage: Statistics").click());
    expect(costliest.textContent).toContain("The Initiative's Threads$1.50");
    const task = [...costliest.querySelectorAll(".stats-x-fold a")].find(
      (each) => each.textContent === "Add a filter",
    );
    expect(task?.getAttribute("href")).toBe(`/tasks/${TASK_ID}`);
  });

  it("says when nothing is among the most expensive", async () => {
    const { opened } = openStats({ ...FULL, costliestTasks: [], costliestInitiatives: [] });
    const { page } = await opened;
    await until(() =>
      expect(page.textContent).toContain("No Task has had an engine call in the last 7 days."),
    );
  });

  it("shows the fullest engine's windows over time, with the lane of what ran on it", async () => {
    const { opened } = openStats();
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));
    const windows = block(page, "Usage windows over time");

    expect(windows.textContent).toContain("Office-wide");
    // Work account is fuller now, so it comes first.
    expect(tab(windows, "Engine", "Work account").getAttribute("aria-selected")).toBe("true");
    expect(windows.textContent).toContain("5-hour window 60%");
    expect(windows.textContent).toContain("What was running on Work account");
    const bar = windows.querySelector<HTMLAnchorElement>(".stats-lane-bar");
    expect(bar?.getAttribute("href")).toBe(`/tasks/${TASK_ID}`);
    expect(bar?.getAttribute("aria-label")).toContain("Add a filter, Implement");

    act(() => tab(windows, "Engine", "Home account").click());
    expect(windows.textContent).toContain("Nothing ran on Home account in the last 7 days.");

    act(() => button(windows, "Show as a table").click());
    expect(windows.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("says when no engine has Usage windows", async () => {
    const { opened } = openStats({ ...FULL, windows: [], running: [] });
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Add a filter"));
    expect(block(page, "Usage windows over time").textContent).toContain(
      "None of your engines has Usage windows.",
    );
  });
});

describe("the full stats' states", () => {
  it.each([
    [
      { state: "starting", address: "http://127.0.0.1:3300" },
      "Grafana is starting…",
      "The first start pulls its image, which can take a few minutes.",
    ],
    [
      { state: "failed", address: "http://127.0.0.1:3300", problem: "Docker isn't installed." },
      "The bundled Grafana couldn't start",
      "Docker isn't installed.",
    ],
    [
      {
        state: "unreachable",
        address: "http://127.0.0.1:3300",
        problem: "No answer within 10 seconds.",
      },
      "Couldn't reach Grafana at http://127.0.0.1:3300",
      "No answer within 10 seconds.",
    ],
    [
      { state: "rejected", address: "https://grafana.example.com" },
      "Grafana refused the read token",
      "Grafana at https://grafana.example.com answered 401. Give a Viewer service account token in Settings › Telemetry.",
    ],
    [
      { state: "no-data", address: "http://127.0.0.1:3300" },
      "Grafana has no data from The Office yet.",
      "The full stats start with the next engine call.",
    ],
  ] satisfies [FullStats, string, string][])(
    "says so above the basic stats, with no message at the foot",
    async (state, title, text) => {
      const { opened } = openStats(state);
      const { page } = await opened;
      await until(() => expect(page.textContent).toContain(title));

      expect(page.textContent).toContain(text);
      expect(headings(page)).toEqual([
        "Tokens per day",
        "Usage windows now",
        "The Tasks with the most tokens this week",
        "This week",
      ]);
      expect(page.querySelector("[aria-label='The full stats']")).toBeNull();
      expect(page.querySelector("[role='group'][aria-label='Range']")).toBeNull();
    },
  );

  it.each(["failed", "unreachable", "rejected"] as const)(
    "leads to Settings › Telemetry when %s",
    async (state) => {
      const { opened } = openStats({
        state,
        address: "http://127.0.0.1:3300",
        problem: "Why",
      } as FullStats);
      const { page } = await opened;
      await until(() =>
        expect(page.querySelector(".stats-page a[href='/settings/telemetry']")).not.toBeNull(),
      );
    },
  );

  it("reads Grafana again on Try again", async () => {
    const { sent, opened } = openStats({
      state: "unreachable",
      address: "http://127.0.0.1:3300",
    });
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Couldn't reach Grafana"));
    expect(page.textContent).toContain("No answer from Grafana.");
    const before = sent.filter(({ request }) => request === FULL_PATH).length;

    act(() => button(page, "Try again").click());
    await until(() =>
      expect(sent.filter(({ request }) => request === FULL_PATH).length).toBe(before + 1),
    );
  });

  it("keeps the basic stats while the full stats load, with their loaders", async () => {
    const { opened } = openStats(FULL, {}, { holdFull: true });
    const { page } = await opened;
    await until(() => expect(page.textContent).toContain("Tasks done"));

    expect(headings(page)).toContain("Tokens and estimated cost over time");
    expect(block(page, "The most expensive").querySelector("[role='status']")).not.toBeNull();
    expect(block(page, "This week").textContent).toContain("Tasks done4");
  });
});

describe("the full stats under a Project filter", () => {
  afterEach(() => {
    localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });
  });

  it("names each Project shown", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["p1", "p2"]));
    const path = "GET /api/stats/full?range=7d&split=model&project=p1&project=p2";
    const { sent, opened } = openStats(FULL, {
      // Unknown Projects, so the filter stays as kept.
      "GET /api/projects": () => ({ status: 404 }),
      [path]: () => ({ status: 200, body: FULL }),
      "GET /api/stats/basic?project=p1&project=p2": () => ({ status: 200, body: BASIC }),
    });
    const { page } = await opened;
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    await until(() => expect(sent.map(({ request }) => request)).toContain(path));
    await until(() => expect(page.textContent).toContain("Add a filter"));
    expect(block(page, "Usage windows over time").textContent).toContain(
      "The Project filter doesn't narrow this",
    );
  });
});

function intervalOf(data: FullStats | undefined): unknown {
  const { refetchInterval } = statsQueries.full("all", "7d", "model");
  if (typeof refetchInterval !== "function") throw new Error("No refetch interval.");
  return refetchInterval({ state: { data } } as Parameters<typeof refetchInterval>[0]);
}

describe("reading the full stats again", () => {
  it("reads them every minute, every 3 s while Grafana starts", () => {
    expect(intervalOf(FULL)).toBe(60_000);
    expect(intervalOf({ state: "unreachable", address: "http://127.0.0.1:3300" })).toBe(60_000);
    expect(intervalOf(undefined)).toBe(60_000);
    expect(intervalOf({ state: "starting", address: "http://127.0.0.1:3300" })).toBe(3_000);
  });
});

describe("a Stage run's stretch", () => {
  it("names its end's day when it ends on another", () => {
    const from = new Date(2026, 10, 16, 23, 30).toISOString();
    const sameDayEnd = new Date(2026, 10, 16, 23, 50).toISOString();
    const nextDayEnd = new Date(2026, 10, 17, 0, 40).toISOString();

    expect(stretchWords(from, sameDayEnd)).toBe("Mon 16 Nov, 23:30–23:50");
    expect(stretchWords(from, nextDayEnd)).toBe("Mon 16 Nov, 23:30–Tue 17 Nov, 00:40");
    expect(stretchWords(from, undefined)).toBe("Mon 16 Nov, 23:30–still running");
  });
});
