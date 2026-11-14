import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Initiative, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { GroupedBoard } from "./board-group.tsx";
import type { BoardGroupFolds } from "./board-group-folds.ts";
import type { BoardGroup } from "./board-groups.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so a tooltip never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const INITIATIVE = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  name: "Offline sync for the field app",
  state: "active",
  pausedAt: null,
  projectIds: [],
} as unknown as Initiative;

const TASK = {
  id: "a",
  state: "ready",
  initiativeId: INITIATIVE.id,
  blockedBy: [],
} as unknown as Task;

const GROUP: BoardGroup = {
  key: INITIATIVE.id,
  initiative: INITIATIVE,
  onBoard: [TASK],
  inProjects: [TASK],
  shown: [TASK],
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

async function rendered(folds: BoardGroupFolds): Promise<HTMLElement> {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <GroupedBoard
          grouping={{ kind: "all", groups: [GROUP], leftOut: [], nothingMatches: false }}
          tasks={[TASK]}
          queue={[]}
          projects={[]}
          cto={undefined}
          planner="Jan"
          folds={folds}
          cardsArea={() => null}
          canLandIn={() => false}
        />
      ),
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

function foldsSpy(): BoardGroupFolds & { readonly toggle: Mock<(group: BoardGroup) => void> } {
  return { isOpen: () => true, toggle: vi.fn<(group: BoardGroup) => void>(), setAll: () => {} };
}

function press(element: Element | null): void {
  if (!element) throw new Error("Nothing to press");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

describe("a group's head", () => {
  it("folds the group on a press on its empty space", async () => {
    const folds = foldsSpy();
    const page = await rendered(folds);

    press(page.querySelector(".group-head"));

    expect(folds.toggle).toHaveBeenCalledExactlyOnceWith(GROUP);
  });

  it("folds the group on a press on its sub-line", async () => {
    const folds = foldsSpy();
    const page = await rendered(folds);

    press(page.querySelector(".group-sub"));

    expect(folds.toggle).toHaveBeenCalledExactlyOnceWith(GROUP);
  });

  it("folds the group once on a press on its name, the fold button", async () => {
    const folds = foldsSpy();
    const page = await rendered(folds);

    press(page.querySelector(".group-name"));

    expect(folds.toggle).toHaveBeenCalledExactlyOnceWith(GROUP);
  });

  it("leaves the group as it is on a press on Open Initiative", async () => {
    const folds = foldsSpy();
    const page = await rendered(folds);

    press(page.querySelector(`a[aria-label="Open Initiative ${INITIATIVE.name}"]`));

    expect(folds.toggle).not.toHaveBeenCalled();
  });
});
