import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Idea, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { ideaQueries, taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { DescriptionBlock } from "./description-block.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BACKLOG_TASK: Task = {
  id: "00000000-0000-4000-8000-000000000011",
  title: "Sign-in keeps the page",
  description: "Keep the query string.",
  projectId: "firmware",
  priority: "normal",
  tags: [],
  state: "backlog",
  plan: "",
  pausedByAlarm: false,
  autoMode: false,
  initiativePlanningThreadId: null,
  markedPlanned: false,
  hasPlanningThread: false,
  planConfirmed: false,
  filesToChange: [],
  estimatedTokens: null,
  definitionOfDone: [],
  definitionOfDoneConfirmed: false,
  pipelineId: "full",
  proposedPipeline: null,
  blockedBy: [],
  originIdeaId: null,
  initiativeId: null,
  projectMoves: [],
  createdBy: { kind: "user" },
  createdAt: "2026-10-28T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
};

const IDEA: Idea = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4e",
  title: "Usage exports",
  notes: "",
  projectId: null,
  state: "shaped",
  taskId: BACKLOG_TASK.id,
  initiativeId: null,
  capturedBy: { kind: "user" },
  capturedAt: "2026-11-07T10:00:00.000Z",
  droppedAt: null,
};

/** The Task's Description block, in a router of its own for its links. */
async function descriptionOf(task: Task): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(taskQueries.list().queryKey, [task]);
  queryClient.setQueryData(projectQueries.list().queryKey, []);
  queryClient.setQueryData(ideaQueries.one(IDEA.id).queryKey, IDEA);
  const rootRoute = createRootRoute({ component: () => <DescriptionBlock task={task} /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
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

function sectionOf(page: HTMLElement, name: string): HTMLElement | null {
  return page.querySelector(`section[aria-label="${name}"]`);
}

describe("the Description block", () => {
  afterEach(() => document.body.replaceChildren());

  it("starts open on a started Task", async () => {
    const page = await descriptionOf({
      ...BACKLOG_TASK,
      id: "00000000-0000-4000-8000-000000000012",
      state: "in-progress",
    });

    expect(page.querySelector<HTMLElement>(".record-fold-body")?.hidden).toBe(false);
    expect(page.textContent).toContain("Keep the query string.");
  });

  it("shows its Dependencies with Add before the Task starts", async () => {
    const page = await descriptionOf(BACKLOG_TASK);
    const dependencies = sectionOf(page, "Dependencies");
    const add = [...(dependencies?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent.startsWith("Add"),
    );

    expect(dependencies?.closest('section[aria-label="Description"]')).not.toBeNull();
    expect(dependencies?.textContent).toContain("It waits for no Task, and none waits for it.");

    act(() => add?.click());

    expect(document.body.textContent).toContain("What must be Done first?");
  });

  it("shows its Origin only when the Task has one", async () => {
    const page = await descriptionOf(BACKLOG_TASK);

    expect(sectionOf(page, "Origin")).toBeNull();

    const shaped = await descriptionOf({
      ...BACKLOG_TASK,
      id: "00000000-0000-4000-8000-000000000013",
      originIdeaId: IDEA.id,
    });

    expect(sectionOf(shaped, "Origin")?.textContent).toContain("Usage exports");
  });
});
