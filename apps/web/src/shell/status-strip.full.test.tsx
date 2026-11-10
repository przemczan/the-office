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
