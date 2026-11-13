import type { QueuedTask } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { QueuedCardMark } from "./queue-parts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the tooltip never resizes.
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

function rendered(queued: QueuedTask): HTMLElement {
  const page = document.createElement("div");
  document.body.append(page);
  act(() => createRoot(page).render(<QueuedCardMark queued={queued} />));
  return page;
}

function shortReasons(page: HTMLElement): string | undefined {
  return page.querySelector(".queued-short-reasons")?.textContent;
}

function hoverShortReasons(page: HTMLElement): void {
  act(() => {
    page
      .querySelector(".queued-short-reasons")
      ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

function fullReasons(): string[] {
  const tooltip = document.querySelector('[role="tooltip"]');
  return [...(tooltip?.querySelectorAll(".queued-full-reasons > span") ?? [])].map(
    (line) => line.textContent,
  );
}

describe("QueuedCardMark", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("shows the short reasons, each once, and leaves the blockers to the card's own line", () => {
    const page = rendered(
      queuedTask([
        [BLOCKED, "Blocked"],
        [OFFICE_WIDE_LIMIT, "Office-wide limit reached (3)"],
        [WINDOW_CAP, "5-hour window cap (80%) · resets 14:30"],
        [OTHER_ENGINE_WINDOW_CAP, "5-hour window cap (80%) · resets 14:30"],
      ]),
    );

    expect(shortReasons(page)).toBe(
      "Office-wide limit reached (3) · 5-hour window cap (80%) · resets 14:30",
    );
  });

  it("shows the full reasons on hover, one to a line, without the blockers", () => {
    const page = rendered(
      queuedTask([
        [BLOCKED, "Blocked"],
        [OFFICE_WIDE_LIMIT, "Office-wide limit reached (3)"],
        [WINDOW_CAP, "5-hour window cap (80%) · resets 14:30"],
      ]),
    );
    expect(fullReasons()).toEqual([]);

    hoverShortReasons(page);

    expect(fullReasons()).toEqual([OFFICE_WIDE_LIMIT, WINDOW_CAP]);
  });

  it("shows only Queued when its blockers alone hold it", () => {
    const page = rendered(queuedTask([[BLOCKED, "Blocked"]]));

    expect(shortReasons(page)).toBeUndefined();
    expect(page.querySelector(".tooltip-trigger")).toBeNull();
  });
});
