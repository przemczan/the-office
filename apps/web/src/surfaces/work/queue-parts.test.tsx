import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PastUsageCaps, QueuedTask, StartCheck, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { QueuedCardMark } from "./queue-parts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the tooltip and the popover never resize.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const OFFICE_WIDE_LIMIT = "The Office-wide limit is reached: all 3 desks are in use.";
const WINDOW_CAP =
  "The Claude Code engine's 5-hour window would pass its 80% cap: 78% used, 0% expected of the Tasks started since it was read and 4% of this Task. It resets at 14:30.";
const OTHER_ENGINE_WINDOW_CAP = WINDOW_CAP.replace("Claude Code", "Work account");
const BLOCKED = 'Blocked by "Queue schema", which must be Done first.';
const OVERLAP = 'Queued behind "Rework the importer" until it is Done or Dropped.';

const TASK = { id: "6f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f", title: "Hosted test instances" };

function queuedTask(reasons: readonly [string, string][]): QueuedTask {
  return {
    taskId: TASK.id,
    place: 1,
    queuedAt: "2026-11-13T09:00:00.000Z",
    reasons: reasons.map(([reason]) => reason),
    shortReasons: reasons.map(([, short]) => short),
    behind: [],
  };
}

const roots: Root[] = [];

/** The Task's start check as read, with what starting it anyway past its usage caps does. */
function startCheckWith(pastUsageCaps: PastUsageCaps | null): StartCheck {
  return {
    refusals: [],
    waits: [],
    blockers: [],
    overlaps: [],
    usageEstimate: null,
    pastUsageCaps,
  };
}

async function rendered(
  queued: QueuedTask,
  behind: readonly Pick<Task, "id" | "title">[] = [],
  blockers = 0,
  pastUsageCaps: PastUsageCaps | null = null,
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(taskQueries.startCheck(TASK.id).queryKey, startCheckWith(pastUsageCaps));
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueuedCardMark task={TASK} queued={queued} behind={behind} blockers={blockers} />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return page;
}

const clock = (page: HTMLElement): HTMLButtonElement | null =>
  page.querySelector<HTMLButtonElement>('button[aria-label="Queued"]');

function hover(page: HTMLElement): void {
  act(() => {
    clock(page)?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

function press(page: HTMLElement): void {
  act(() => clock(page)?.click());
}

const tooltip = (): Element | null => document.querySelector('[role="tooltip"]');
const popover = (): Element | null => document.querySelector('[role="dialog"]');

const startAnywayButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    // The design system's button carries its spinner's keyframes in its text.
    (button) => button.textContent.startsWith("Start anyway"),
  );

const fullReasons = (): string[] =>
  [...(popover()?.querySelectorAll(".queued-full-reasons > li") ?? [])].map(
    (line) => line.textContent,
  );

describe("QueuedCardMark", () => {
  afterEach(() => {
    // Unmounted first, as an open popover lies on the body, outside the page.
    act(() => roots.splice(0).forEach((root) => root.unmount()));
    document.body.replaceChildren();
  });

  it("shows the clock alone, with the short reasons, each once, on hover", async () => {
    const page = await rendered(
      queuedTask([
        [BLOCKED, "Blocked"],
        [OFFICE_WIDE_LIMIT, "Office-wide limit reached (3)"],
        [WINDOW_CAP, "5-hour window cap (80%) · resets 14:30"],
        [OTHER_ENGINE_WINDOW_CAP, "5-hour window cap (80%) · resets 14:30"],
      ]),
    );
    expect(page.textContent).toBe("");

    hover(page);

    expect(tooltip()?.textContent).toBe(
      "Queued: Office-wide limit reached (3) · 5-hour window cap (80%) · resets 14:30",
    );
  });

  it("shows its place and the full reasons on a press, one to a line, without the blockers", async () => {
    const page = await rendered(
      queuedTask([
        [BLOCKED, "Blocked"],
        [OFFICE_WIDE_LIMIT, "Office-wide limit reached (3)"],
        [WINDOW_CAP, "5-hour window cap (80%) · resets 14:30"],
      ]),
      [],
      1,
    );
    expect(popover()).toBeNull();

    press(page);

    expect(popover()?.textContent).toContain("Queued, place 1");
    expect(fullReasons()).toEqual([OFFICE_WIDE_LIMIT, WINDOW_CAP]);
    expect(popover()?.querySelector(".popover-foot")?.textContent).toBe(
      "And its 1 blocker, under the lock.",
    );
  });

  it("links the Tasks it is queued behind", async () => {
    const page = await rendered(queuedTask([[OVERLAP, 'Behind "Rework the importer"']]), [
      { id: "0b7f0c6e-2d0b-4c55-9d1c-6f0e2b9d4a11", title: "Rework the importer" },
    ]);

    press(page);

    const link = popover()?.querySelector(".queued-behind a");
    expect(link?.textContent).toBe("Rework the importer");
    expect(link?.getAttribute("href")).toBe("/tasks/0b7f0c6e-2d0b-4c55-9d1c-6f0e2b9d4a11");
  });

  it("offers Start anyway while only its usage holds it, asking first with the caps and engines", async () => {
    const page = await rendered(
      queuedTask([[WINDOW_CAP, "5-hour window cap (80%) · resets 14:30"]]),
      [],
      0,
      {
        passes: ["Personal: 5-hour window cap (80%) · resets 14:30"],
        engines: [{ name: "Personal", standingInFor: "Work" }],
        refusals: [],
      },
    );
    press(page);
    const startAnyway = startAnywayButton();
    expect(startAnyway?.disabled).toBe(false);

    act(() => startAnyway?.click());

    const asked = document.querySelector('[aria-modal="true"]');
    expect(asked?.textContent).toContain("Start Hosted test instances anyway?");
    expect(asked?.textContent).toContain("Personal: 5-hour window cap (80%) · resets 14:30");
    expect(asked?.textContent).toContain("Its Stages run on Personal, standing in for Work.");
  });

  it("disables Start anyway with why while every engine's window is used up", async () => {
    const usedUp = "Work's 7-day window is used up until Sat 08:00.";
    const page = await rendered(
      queuedTask([[usedUp, "7-day window used up · until Sat 08:00"]]),
      [],
      0,
      { passes: [], engines: [{ name: "Work", standingInFor: null }], refusals: [usedUp] },
    );

    press(page);

    expect(startAnywayButton()?.disabled).toBe(true);
    expect(popover()?.textContent).toContain(usedUp);
  });

  it("offers no Start anyway while anything but its usage holds it", async () => {
    const page = await rendered(queuedTask([[OFFICE_WIDE_LIMIT, "Office-wide limit reached (3)"]]));

    press(page);

    expect(startAnywayButton()).toBeUndefined();
  });

  it("says only Queued on hover when its blockers alone hold it", async () => {
    const page = await rendered(queuedTask([[BLOCKED, "Blocked"]]));

    hover(page);

    expect(tooltip()?.textContent).toBe("Queued");
  });
});
