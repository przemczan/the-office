import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  NeedsYouItem,
  Notification,
  Now,
  Role,
  WaitingForYouItem,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notificationQueries, nowQueries } from "../api/notifications.ts";
import { roleQueries } from "../api/people.ts";
import { StatusStrip } from "./status-strip.tsx";
import { momentWords } from "./time.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver; the list's placing only needs it to exist.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
// The queries tell the strip of each change at once, not on a later tick, so each step renders.
notifyManager.setScheduler((notify) => notify());

vi.mock("../api/event-stream-provider.tsx", () => ({ useEventStreamStatus: () => "connected" }));
vi.mock("@tanstack/react-router", () => ({
  Link: () => null,
  useNavigate: () => () => undefined,
  useSearch: () => ({}),
}));

const WINDOW_RESET: Notification = {
  id: "5d0c8a2e-3f6b-4a8e-9c1d-7b2e4f6a8c10",
  kind: "office.window.reset",
  roleKey: "office-manager",
  line: "Claude's 5-hour window reset, so we have all of it again.",
  shortLine: "Claude's window reset",
  pointsTo: { kind: "office" },
  channels: ["in-app"],
  held: [],
  raisedAt: "2026-11-09T09:00:00.000Z",
};
const OSCAR = { key: "office-manager", card: { name: "Oscar" } } as unknown as Role;

let queryClient: QueryClient;
let strip: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // The figures and the scheduled update stay loading: these tests are about the Notifications.
  vi.stubGlobal("fetch", () => new Promise<never>(() => undefined));
  // The browser was asked for desktop Notifications already, so the ask isn't among the messages.
  vi.stubGlobal("Notification", { permission: "granted" });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(notificationQueries.open().queryKey, [WINDOW_RESET]);
  strip = document.createElement("div");
  root = createRoot(strip);
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});

function renderWith(roles: readonly Role[]): void {
  queryClient.setQueryData(roleQueries.list().queryKey, [...roles]);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <StatusStrip />
      </QueryClientProvider>,
    ),
  );
}

const WINDOW_NEARLY_USED: Notification = {
  ...WINDOW_RESET,
  id: "6e1d9b3f-4a7c-4b9f-8d2e-8c3f5a7b9d21",
  kind: "office.window.nearly-used",
  line: "Claude's 5-hour window is nearly used.",
  shortLine: "Claude: 91% of 5-hour window",
  raisedAt: "2026-11-09T12:00:00.000Z",
};
const ENGINE_DOWN: Notification = {
  ...WINDOW_RESET,
  id: "7f2eac40-5b8d-4ca0-9e3f-9d4a6b8cae32",
  kind: "office.down.engine",
  line: "Claude can't be reached: connection refused (ECONNREFUSED 127.0.0.1:8443).",
  shortLine: "Claude is down",
  raisedAt: "2026-11-09T15:00:00.000Z",
};

function slot(): HTMLButtonElement | null {
  return strip.querySelector<HTMLButtonElement>(".shell-strip-slot");
}

function list(): HTMLElement | null {
  return document.body.querySelector("[role='dialog'][aria-label^='Office Notifications']");
}

it("shows an Office Notification by its short line, with who says it and when", () => {
  renderWith([OSCAR]);

  expect(slot()?.querySelector(".shell-strip-slot-short")?.textContent).toBe(
    WINDOW_RESET.shortLine,
  );
  expect(slot()?.querySelector(".shell-strip-slot-meta")?.textContent).toContain(
    `Oscar · ${momentWords(WINDOW_RESET.raisedAt)}`,
  );
  expect(slot()?.textContent).not.toContain("+");
});

it("shows the time alone while nobody is the Office Manager, never a name", () => {
  renderWith([]);

  expect(slot()?.querySelector(".shell-strip-slot-meta")?.textContent).toBe(
    momentWords(WINDOW_RESET.raisedAt),
  );
});

it("shows an older Office Notification without a short line by its whole line", () => {
  const { shortLine: _shortLine, ...older } = WINDOW_RESET;
  queryClient.setQueryData(notificationQueries.open().queryKey, [older]);
  renderWith([]);

  expect(slot()?.querySelector(".shell-strip-slot-short")?.textContent).toBe(WINDOW_RESET.line);
});

it("shows the newest of several Office Notifications and +N, and lists them all whole", () => {
  queryClient.setQueryData(notificationQueries.open().queryKey, [
    WINDOW_RESET,
    WINDOW_NEARLY_USED,
    ENGINE_DOWN,
  ]);
  renderWith([]);

  expect(slot()?.querySelector(".shell-strip-slot-short")?.textContent).toBe("Claude is down");
  expect(slot()?.querySelector(".shell-strip-slot-count")?.textContent).toBe("+2");
  expect(slot()?.className).toContain("tone-danger");
  expect(list()).toBeNull();

  act(() => slot()?.click());

  const items = [...(list()?.querySelectorAll("li p:first-child") ?? [])];
  expect(items.map(({ textContent }) => textContent)).toEqual([
    ENGINE_DOWN.line,
    WINDOW_NEARLY_USED.line,
    WINDOW_RESET.line,
  ]);
  expect(slot()?.getAttribute("aria-expanded")).toBe("true");

  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(list()).toBeNull();
});

it("follows the open Office Notifications as they clear, and is gone with none", () => {
  queryClient.setQueryData(notificationQueries.open().queryKey, [WINDOW_RESET, ENGINE_DOWN]);
  renderWith([]);

  act(() => queryClient.setQueryData(notificationQueries.open().queryKey, [WINDOW_RESET]));
  expect(slot()?.querySelector(".shell-strip-slot-short")?.textContent).toBe(
    WINDOW_RESET.shortLine,
  );
  expect(slot()?.querySelector(".shell-strip-slot-count")).toBeNull();

  act(() => queryClient.setQueryData(notificationQueries.open().queryKey, []));
  expect(slot()).toBeNull();
});

const NOW: Now = {
  needsYou: [],
  waitingForYou: [],
  running: [],
  queue: [],
  shaping: [],
  tokensToday: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  desks: { inUse: 0, limit: 3 },
  usageWindows: [],
  fireAlarm: null,
};
const A_DECISION: NeedsYouItem = {
  kind: "decision",
  decisionId: "0b6a4f1e-6a55-4c1c-9d51-2f0d5a1c7e10",
  taskId: "6820f3e0-132c-414a-9d26-ed497c7ea9bf",
  projectId: "billing",
  waitingSince: "2026-11-13T09:00:00.000Z",
};
const SKILL_UPDATES: WaitingForYouItem = {
  kind: "skill-updates",
  skillNames: ["pdf"],
  count: 1,
  projectIds: [],
  waitingSince: null,
};
const OFFICE_UPDATE: WaitingForYouItem = {
  kind: "office-update",
  target: {
    kind: "commit",
    commit: "abc1234def5678",
    shortCommit: "abc1234",
    subject: "fix: a thing",
    committedAt: "2026-11-13T09:00:00.000Z",
  },
  projectIds: [],
  waitingSince: "2026-11-13T09:00:00.000Z",
};

function needsYouFigure(): HTMLButtonElement | null {
  return strip.querySelector<HTMLButtonElement>("button.shell-strip-needs-you");
}

it("shows a small count of what is Waiting for you beside Needs you's, said in the figure's name", () => {
  queryClient.setQueryData(nowQueries.now().queryKey, {
    ...NOW,
    needsYou: [A_DECISION],
    waitingForYou: [SKILL_UPDATES, OFFICE_UPDATE],
  });
  renderWith([]);

  const figure = needsYouFigure();
  expect(figure?.querySelector(".shell-strip-value b")?.textContent).toBe("1");
  const waiting = figure?.querySelector(".shell-strip-faint.shell-strip-waiting");
  expect(waiting?.getAttribute("title")).toBe("2 waiting for you");
  expect(waiting?.querySelector(".shell-strip-roomy")?.textContent).toBe("· 2 waiting");
  expect(waiting?.querySelector(".shell-strip-tight")?.textContent).toBe("·2");
  expect(figure?.getAttribute("aria-label")).toMatch(/, 2 waiting for you$/);
  expect(figure?.className).toContain("alert");
});

it("stays quiet with only what is Waiting for you: no alert, no live dot, Needs you at 0", () => {
  queryClient.setQueryData(nowQueries.now().queryKey, { ...NOW, waitingForYou: [SKILL_UPDATES] });
  renderWith([]);

  const figure = needsYouFigure();
  expect(figure?.className).not.toContain("alert");
  expect(figure?.querySelector(".live-dot")).toBeNull();
  expect(figure?.querySelector(".shell-strip-value b")?.textContent).toBe("0");
  expect(figure?.querySelector(".shell-strip-waiting")?.getAttribute("title")).toBe(
    "1 waiting for you",
  );
});

it("shows no Waiting for you count while nothing waits", () => {
  queryClient.setQueryData(nowQueries.now().queryKey, { ...NOW, needsYou: [A_DECISION] });
  renderWith([]);

  const figure = needsYouFigure();
  expect(figure?.querySelector(".shell-strip-waiting")).toBeNull();
  expect(figure?.getAttribute("aria-label")).not.toContain("waiting");
  expect(figure?.querySelector(".live-dot")).not.toBeNull();
});
