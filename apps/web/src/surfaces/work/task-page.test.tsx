import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { EngineStandIn, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineQueries, projectPipelineQueries } from "../../api/pipelines.ts";
import { taskQueries } from "../../api/work.ts";
import { PageHeadingProvider } from "../../shell/page-heading.tsx";
import { ToastProvider } from "../../shell/toasts.tsx";
import { EngineStandInsMark, TaskPage } from "./task-page.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the tooltip, placed by its size, never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const FOR_WORK: EngineStandIn = {
  engineId: "work",
  engineName: "Work",
  standInId: "personal",
  standInName: "Personal",
  reason: "Work's 5-hour window would be passed; Personal had room.",
  short: "Work's window is full",
};

function aTask(fields: Partial<Task>): Task {
  return {
    id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
    title: "Remember the sort",
    description: "",
    projectId: "admin-panel",
    priority: "normal",
    tags: [],
    state: "in-progress",
    plan: "",
    pausedBy: null,
    engineStandIns: [],
    resumesAt: null,
    autoMode: false,
    initiativePlanningThreadId: null,
    markedPlanned: false,
    hasPlanningThread: false,
    planConfirmed: true,
    filesToChange: [],
    estimatedTokens: null,
    definitionOfDone: [],
    definitionOfDoneConfirmed: true,
    commitMessage: "Commit message",
    commitMessageWritten: false,
    commitMessagePublishedAt: null,
    pipelineId: "full",
    proposedPipeline: null,
    blockedBy: [],
    originIdeaId: null,
    initiativeId: null,
    madeFor: null,
    resolvesTaskId: null,
    projectMoves: [],
    createdBy: { kind: "user", user: null },
    createdAt: "2026-11-11T10:00:00.000Z",
    archivedAt: null,
    endedAt: null,
    pullRequestEnd: null,
    ...fields,
  };
}

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function show(task: Task): HTMLElement {
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  act(() => root.render(<EngineStandInsMark task={task} />));
  return page;
}

describe("EngineStandInsMark", () => {
  it("names the Stand-in Engine a started Task works on, with why on hover", () => {
    const page = show(aTask({ engineStandIns: [FOR_WORK] }));
    expect(page.textContent).toBe("On a Stand-in Engine: Personal for Work");
    act(() => {
      page
        .querySelector(".tooltip-trigger")
        ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(FOR_WORK.reason);
  });

  it("shows nothing for a started Task on the cascade's engines", () => {
    expect(show(aTask({ engineStandIns: [] })).textContent).toBe("");
  });

  it("shows nothing once the Task is no longer started", () => {
    expect(show(aTask({ state: "done", engineStandIns: [FOR_WORK] })).textContent).toBe("");
  });
});

/**
 * The service as the page reads it: each path that fails answers its problem, every other read
 * stays on its way, so what the test put in the cache is all that has arrived.
 */
function stubService(failing: Readonly<Record<string, string>> = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input), "http://office").pathname.replace(/^\/api/, "");
      const problem = failing[path];
      if (problem === undefined) return new Promise<Response>(() => undefined);
      return Response.json({ message: problem }, { status: 500 });
    }),
  );
}

/** The Task page at the Task's address, with what has arrived already in its cache. */
async function openTaskPage(arrived: (queryClient: QueryClient) => void): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  arrived(queryClient);
  const rootRoute = createRootRoute();
  const taskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "tasks/$taskId",
    component: TaskPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([taskRoute]),
    history: createMemoryHistory({ initialEntries: [`/tasks/${TASK.id}`] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <PageHeadingProvider setPageHeading={() => undefined}>
            <RouterProvider router={router} />
          </PageHeadingProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

const TASK = aTask({});

function taskAndPipelinesArrived(queryClient: QueryClient): void {
  queryClient.setQueryData(taskQueries.one(TASK.id).queryKey, TASK);
  queryClient.setQueryData(pipelineQueries.list().queryKey, []);
  queryClient.setQueryData(projectPipelineQueries.every().queryKey, []);
}

/** What each loader says to screen readers. */
function loadersIn(page: HTMLElement): (string | null)[] {
  return [...page.querySelectorAll('[role="status"] > .visually-hidden')].map(
    ({ textContent }) => textContent,
  );
}

/** What each block whose read failed says: the design system's Alert is a status too. */
function problemsIn(page: HTMLElement): (string | null)[] {
  return [...page.querySelectorAll('[role="status"]:not(.block-loader)')].map(
    ({ textContent }) => textContent,
  );
}

/** Waits for the reads that fail to answer and the page to show it. */
async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the Task page while it loads", () => {
  it("shows its frame, with the rail, the record and the conversation loading, until the Task arrives", async () => {
    stubService();

    const page = await openTaskPage(() => undefined);

    expect(loadersIn(page)).toEqual([
      "Loading the Pipeline…",
      "Loading the Task…",
      "Loading the conversation…",
    ]);
    expect(page.querySelector(".task-head-loader")).not.toBeNull();
    expect(
      page.querySelector(".task-columns .task-record-column .block-loader.text"),
    ).not.toBeNull();
    expect(
      page.querySelector(".task-columns .task-conversation .block-loader.turns"),
    ).not.toBeNull();
  });

  it("keeps the rail's and the conversation's loaders once the Task arrives, until their own reads do", async () => {
    stubService();

    const page = await openTaskPage(taskAndPipelinesArrived);

    expect(page.querySelector(".task-head h2")?.textContent).toBe(TASK.title);
    expect(page.querySelector(".task-head-loader")).toBeNull();
    expect(loadersIn(page)).toEqual(["Loading the Pipeline…", "Loading the conversation…"]);
  });

  it("shows the problem of a read that failed in its block's place", async () => {
    stubService({
      [`/tasks/${TASK.id}/stages`]: "The Stages can't be read",
      [`/tasks/${TASK.id}/conversation`]: "The conversation can't be read",
    });

    const page = await openTaskPage(taskAndPipelinesArrived);
    await settled();

    const problems = problemsIn(page);
    expect(problems).toContain("The Stages can't be read");
    expect(problems).toContain("The conversation can't be read");
    expect(loadersIn(page)).not.toContain("Loading the Pipeline…");
    expect(loadersIn(page)).not.toContain("Loading the conversation…");
  });

  it("shows the Pipelines' problem in the rail's place when they fail before the Task arrives", async () => {
    stubService({ "/pipelines": "The Pipelines can't be read" });

    const page = await openTaskPage(() => undefined);
    await settled();

    const problems = problemsIn(page);
    expect(problems).toEqual(["The Pipelines can't be read"]);
    expect(loadersIn(page)).toEqual(["Loading the Task…", "Loading the conversation…"]);
  });
});
