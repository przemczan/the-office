import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Notification, Role } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notificationQueries } from "../api/notifications.ts";
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
vi.mock("@tanstack/react-router", () => ({ Link: () => null, useNavigate: () => () => undefined }));

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
