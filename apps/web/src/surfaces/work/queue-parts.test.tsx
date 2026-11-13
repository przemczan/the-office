import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { QueuedTask, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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

function queuedTask(reasons: readonly [string, string][]): QueuedTask {
  return {
    taskId: "6f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f",
    place: 1,
    queuedAt: "2026-11-13T09:00:00.000Z",
    reasons: reasons.map(([reason]) => reason),
    shortReasons: reasons.map(([, short]) => short),
    behind: [],
  };
}

const roots: Root[] = [];

async function rendered(
  queued: QueuedTask,
  behind: readonly Pick<Task, "id" | "title">[] = [],
  blockers = 0,
): Promise<HTMLElement> {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <QueuedCardMark queued={queued} behind={behind} blockers={blockers} />,
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  await act(async () => root.render(<RouterProvider router={router} />));
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

  it("says only Queued on hover when its blockers alone hold it", async () => {
    const page = await rendered(queuedTask([[BLOCKED, "Blocked"]]));

    hover(page);

    expect(tooltip()?.textContent).toBe("Queued");
  });
});
