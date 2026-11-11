import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Notification, Role } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notificationQueries } from "../api/notifications.ts";
import { roleQueries } from "../api/people.ts";
import { StatusStrip } from "./status-strip.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The queries tell the strip of each change at once, not on a later tick, so each step renders.
notifyManager.setScheduler((notify) => notify());

vi.mock("../api/event-stream-provider.tsx", () => ({ useEventStreamStatus: () => "connected" }));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));

const WINDOW_RESET: Notification = {
  id: "5d0c8a2e-3f6b-4a8e-9c1d-7b2e4f6a8c10",
  kind: "office.window.reset",
  roleKey: "office-manager",
  line: "Claude's 5-hour window reset, so we have all of it again.",
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

it("shows an Office Notification by the Office Manager's name once one is hired", () => {
  renderWith([OSCAR]);

  expect(strip.textContent).toContain(`Oscar: ${WINDOW_RESET.line}`);
  expect(strip.textContent).not.toContain("[object");
});

it("shows an Office Notification's line alone without an Office Manager", () => {
  renderWith([]);

  expect(strip.textContent).toBe(WINDOW_RESET.line);
});

it("shows one Office Notification plainly, with no button and no count", () => {
  renderWith([]);

  expect(strip.querySelector("button")).toBeNull();
  expect(strip.textContent).not.toContain("more");
  expect(strip.querySelector(`[title="${WINDOW_RESET.line}"]`)).not.toBeNull();
});

const WINDOW_NEARLY_USED: Notification = {
  ...WINDOW_RESET,
  id: "6e1d9b3f-4a7c-4b9f-8d2e-8c3f5a7b9d21",
  kind: "office.window.nearly-used",
  line: "Claude's 5-hour window is nearly used.",
  raisedAt: "2026-11-09T12:00:00.000Z",
};
const ENGINE_DOWN: Notification = {
  ...WINDOW_RESET,
  id: "7f2eac40-5b8d-4ca0-9e3f-9d4a6b8cae32",
  kind: "office.down.engine",
  line: "Claude can't be reached.",
  raisedAt: "2026-11-09T15:00:00.000Z",
};

function moreButton(): HTMLButtonElement {
  const button = strip.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']");
  if (!button) throw new Error("no button opens the other Office Notifications");
  return button;
}

function otherNotificationsList(): HTMLElement | null {
  return document.body.querySelector("[role='dialog'][aria-label='More Office Notifications']");
}

it("shows only the newest of several Office Notifications, with the others in a list", () => {
  queryClient.setQueryData(notificationQueries.open().queryKey, [
    WINDOW_RESET,
    WINDOW_NEARLY_USED,
    ENGINE_DOWN,
  ]);
  renderWith([]);

  expect(strip.textContent).toBe(`${ENGINE_DOWN.line}+2 more`);
  expect(moreButton().getAttribute("aria-expanded")).toBe("false");
  expect(otherNotificationsList()).toBeNull();

  act(() => moreButton().click());

  const items = [...(otherNotificationsList()?.querySelectorAll("li") ?? [])];
  expect(items.map(({ textContent }) => textContent)).toEqual([
    WINDOW_NEARLY_USED.line,
    WINDOW_RESET.line,
  ]);
  expect(moreButton().getAttribute("aria-expanded")).toBe("true");

  act(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(otherNotificationsList()).toBeNull();

  act(() => moreButton().click());
  act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(otherNotificationsList()).toBeNull();
});

it("follows the open Office Notifications as they clear", () => {
  queryClient.setQueryData(notificationQueries.open().queryKey, [
    WINDOW_RESET,
    WINDOW_NEARLY_USED,
    ENGINE_DOWN,
  ]);
  renderWith([]);
  act(() => moreButton().click());

  act(() =>
    queryClient.setQueryData(notificationQueries.open().queryKey, [
      WINDOW_NEARLY_USED,
      ENGINE_DOWN,
    ]),
  );
  expect(strip.textContent).toBe(`${ENGINE_DOWN.line}+1 more`);
  expect(otherNotificationsList()?.textContent).toBe(WINDOW_NEARLY_USED.line);

  act(() => queryClient.setQueryData(notificationQueries.open().queryKey, [ENGINE_DOWN]));
  expect(strip.querySelector("button")).toBeNull();
  expect(otherNotificationsList()).toBeNull();
  expect(strip.textContent).toBe(ENGINE_DOWN.line);
});

it("names the Office Manager in the strip and in the list of several Office Notifications", () => {
  queryClient.setQueryData(notificationQueries.open().queryKey, [WINDOW_RESET, ENGINE_DOWN]);
  renderWith([OSCAR]);

  expect(strip.textContent).toBe(`Oscar: ${ENGINE_DOWN.line}+1 more`);
  act(() => moreButton().click());
  expect(otherNotificationsList()?.textContent).toBe(`Oscar: ${WINDOW_RESET.line}`);
});
