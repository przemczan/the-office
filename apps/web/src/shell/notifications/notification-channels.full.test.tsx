import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Notification, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notificationQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { NotificationChannels } from "./notification-channels.ts";
import type { NotificationChannel } from "./notification-channel.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The queries tell the page of each change at once, not on a later tick, so each step renders.
notifyManager.setScheduler((notify) => notify());

const inApp = vi.hoisted(() => ({
  show: vi.fn<NotificationChannel["show"]>(),
  clear: vi.fn<NotificationChannel["clear"]>(),
}));
vi.mock("./in-app-channel.tsx", () => ({ useInAppChannel: () => inApp }));
vi.mock("../../api/event-stream-provider.tsx", () => ({ useEventStreamStatus: () => "connected" }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));
// jsdom draws no favicon; the badge is not what these tests are about.
vi.mock("./needs-you-tab.ts", () => ({ useNeedsYouTab: () => undefined }));

const TASK_ID = "6820f3e0-132c-414a-9d26-ed497c7ea9bf";
const NOTIFICATION: Notification = {
  id: "0b6a4f1e-6a55-4c1c-9d51-2f0d5a1c7e10",
  kind: "outcomes.task-done",
  roleKey: null,
  line: "The Task is done.",
  pointsTo: { kind: "task", taskId: TASK_ID },
  channels: ["in-app"],
  held: [],
  raisedAt: "2026-10-31T09:00:00.000Z",
};

let queryClient: QueryClient;
let root: Root;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(notificationQueries.open().queryKey, []);
  queryClient.setQueryData(notificationQueries.routing().queryKey, {});
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  queryClient.setQueryData(projectQueries.list().queryKey, []);
  root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <NotificationChannels />
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  vi.clearAllMocks();
});

/** Holds the Task's query in flight, so the toast's words wait for it, until the test lets it go. */
function loadTheTaskSlowly(): { readonly finish: () => Promise<void> } {
  const failed = new AbortController();
  void queryClient
    .fetchQuery({
      queryKey: taskQueries.one(TASK_ID).queryKey,
      queryFn: () =>
        new Promise<Task>((_, reject) => {
          failed.signal.addEventListener("abort", () => reject(failed.signal.reason));
        }),
    })
    .catch(() => undefined);
  return {
    finish: () =>
      act(async () => {
        failed.abort(new Error("The Task could not be read."));
        // The words' promise chain settles over several microtasks; one macrotask outlasts them.
        await new Promise((settled) => setTimeout(settled, 0));
      }),
  };
}

function setOpen(open: readonly Notification[]): void {
  act(() => queryClient.setQueryData(notificationQueries.open().queryKey, [...open]));
}

it("shows a raised Notification once its words are ready", async () => {
  const task = loadTheTaskSlowly();

  setOpen([NOTIFICATION]);
  await task.finish();

  expect(inApp.show).toHaveBeenCalledOnce();
  expect(inApp.show.mock.calls[0]?.[0]).toMatchObject({ id: NOTIFICATION.id });
});

it("never shows a Notification cleared while its words were loading", async () => {
  const task = loadTheTaskSlowly();

  setOpen([NOTIFICATION]);
  setOpen([]);
  await task.finish();

  expect(inApp.show).not.toHaveBeenCalled();
});

it("shows a Notification cleared and raised again while loading once, not twice", async () => {
  const task = loadTheTaskSlowly();

  setOpen([NOTIFICATION]);
  setOpen([]);
  setOpen([NOTIFICATION]);
  await task.finish();

  expect(inApp.show).toHaveBeenCalledOnce();
});

it("shows the time a Notification names worded in the browser's time zone", async () => {
  const task = loadTheTaskSlowly();
  const at = new Date();
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

  setOpen([
    {
      ...NOTIFICATION,
      kind: "outcomes.task-paused",
      line: "Paused: Claude Code's 5-hour window is used up. Resumes at {time}.",
      at: at.toISOString(),
    },
  ]);
  await task.finish();

  expect(inApp.show.mock.calls[0]?.[0]).toMatchObject({
    line: `Paused: Claude Code's 5-hour window is used up. Resumes at ${clock}.`,
  });
});
