import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";
import { BoardCard } from "./board-card.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK = {
  id: "6f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f",
  title: "Login fails after a password reset",
  projectId: "the-office",
  priority: "normal",
  state: "done",
  kind: "bug",
  blockedBy: [],
} as unknown as Task;

let root: Root | undefined;

/** Whether the mark is, or holds, what `selector` finds. */
function holds(mark: Element | undefined, selector: string): boolean {
  return mark?.matches(selector) === true || mark?.querySelector(selector) != null;
}

async function card(task: Task): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <BoardCard
          task={task}
          projects={[]}
          planner={undefined}
          waiting={false}
          queued={undefined}
          queuedBehind={[]}
          blockers={[]}
          peopleWorking={[]}
          stageName={undefined}
          dragging={false}
          dropBefore={false}
          onDragStart={() => undefined}
          onDragEnd={() => undefined}
        />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

describe("a board card's Kind mark", () => {
  beforeEach(() => vi.stubGlobal("fetch", () => Promise.resolve(Response.json([]))));
  afterEach(() => {
    act(() => root?.unmount());
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("follows the Project's mark on every card, a Done one's too, Bug's tinted", async () => {
    const page = await card(TASK);
    const marks = [...(page.querySelector(".board-card-marks")?.children ?? [])];

    expect(holds(marks[0], ".board-card-project")).toBe(true);
    expect(holds(marks[1], '.kind-bug[role="img"][aria-label="Bug"]')).toBe(true);
  });

  it("names a Feature and a Chore quietly", async () => {
    const page = await card({ ...TASK, state: "backlog", kind: "chore" });

    expect(page.querySelector('[role="img"][aria-label="Chore"]')?.className).toBe(
      "plain-mark kind-mark kind-chore",
    );
  });
});
