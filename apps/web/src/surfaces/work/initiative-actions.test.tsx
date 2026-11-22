import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Idea, Initiative, Project, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { ideaQueries, taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { InitiativeActions } from "./initiative-actions.tsx";
import { OriginBlock } from "./origin-block.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the head's row of actions never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const IDEA_ID = "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const INITIATIVE: Initiative = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  name: "Usage exports",
  outcome: "",
  state: "shaping",
  originIdeaId: IDEA_ID,
  projectIds: [],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-10T09:00:00.000Z",
  endedAt: null,
  archivedAt: null,
  pausedAt: null,
  planningThreadId: null,
  planningAutoMode: false,
  pipelines: [],
  shortName: null,
  engine: null,
  branches: [],
};

function aProject(id: string, name: string): Project {
  return { id, name, mark: { label: name.slice(0, 2), colour: "teal" } } as Project;
}

const PROJECTS = [aProject("api-service", "API service"), aProject("admin-panel", "Admin panel")];

async function renderedWithIdeaIn(projectId: string | null): Promise<HTMLElement> {
  return rendered(INITIATIVE, (queryClient) =>
    queryClient.setQueryData(ideaQueries.one(IDEA_ID).queryKey, {
      id: IDEA_ID,
      title: "Usage exports",
      notes: "",
      projectId,
      capturedAt: "2026-11-10T08:00:00.000Z",
    } as Idea),
  );
}

async function rendered(
  initiative: Initiative,
  seed: (queryClient: QueryClient) => void = () => undefined,
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(taskQueries.list().queryKey, [] as Task[]);
  queryClient.setQueryData(taskQueries.archived().queryKey, []);
  queryClient.setQueryData(projectQueries.list().queryKey, PROJECTS);
  seed(queryClient);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <>
          <InitiativeActions initiative={initiative} onStartedReadyTasks={() => undefined} />
          <OriginBlock
            record={{ kind: "initiative", id: initiative.id }}
            ideaId={initiative.originIdeaId}
          />
        </>
      ),
    }),
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

async function addATask(page: HTMLElement): Promise<void> {
  await act(async () => {
    [...page.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Add a Task"))
      ?.click();
    await new Promise((resolve) => setTimeout(resolve));
  });
}

function chosenProject(): string | undefined {
  return (
    document.querySelector('[role="radio"][aria-checked="true"]')?.closest("label")?.textContent ??
    undefined
  );
}

describe("Add a Task on an Initiative's page", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(Response.json({}, { status: 404 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("chooses the Project of the Idea it was shaped from while it has no Tasks", async () => {
    const page = await renderedWithIdeaIn("admin-panel");
    expect(page.textContent).toContain("Origin");

    await addATask(page);
    expect(chosenProject()).toContain("Admin panel");
  });

  it("chooses the first Project when the Idea was captured Office-wide", async () => {
    const page = await renderedWithIdeaIn(null);

    await addATask(page);

    expect(chosenProject()).toContain("API service");
  });

  it("works on one created from no Idea, asking for no Idea and showing no Origin", async () => {
    const page = await rendered({ ...INITIATIVE, originIdeaId: null });

    expect(page.textContent).toContain("Confirm");
    expect(page.textContent).not.toContain("Origin");
    await addATask(page);

    expect(chosenProject()).toContain("API service");
    const asked = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(asked.filter((url) => url.includes("/ideas"))).toEqual([]);
  });
});

const ACTIVE: Initiative = {
  ...INITIATIVE,
  state: "active",
  originIdeaId: null,
  projectIds: ["api-service", "admin-panel"],
  shortName: "usage-exports",
  branches: [
    {
      projectId: "api-service",
      branch: "initiative/usage-exports",
      madeAt: INITIATIVE.createdAt,
    },
    {
      projectId: "admin-panel",
      branch: "initiative/usage-exports",
      madeAt: INITIATIVE.createdAt,
    },
  ],
};

function aTask(id: string, state: Task["state"]): Task {
  return { id, title: id, state, initiativeId: ACTIVE.id, projectId: "api-service" } as Task;
}

const TASKS = [
  aTask("one", "backlog"),
  aTask("two", "planning"),
  aTask("three", "ready"),
  aTask("four", "in-progress"),
  aTask("five", "done"),
];

async function renderedActive(initiative: Initiative = ACTIVE): Promise<HTMLElement> {
  return rendered(initiative, (queryClient) =>
    queryClient.setQueryData(taskQueries.list().queryKey, TASKS),
  );
}

function backToShapingButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find(({ textContent }) =>
    textContent.startsWith("Back to Shaping"),
  );
}

function windowShown(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

async function goBack(): Promise<void> {
  await act(async () => {
    [...(windowShown()?.querySelectorAll("button") ?? [])]
      .find(({ textContent }) => textContent.startsWith("Back to Shaping"))
      ?.click();
    await new Promise((resolve) => setTimeout(resolve));
  });
}

describe("Back to Shaping on an Initiative's page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("is offered only while the Initiative is active", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    expect(backToShapingButton(await renderedActive())).toBeDefined();
    document.body.replaceChildren();
    expect(backToShapingButton(await rendered(INITIATIVE))).toBeUndefined();
    document.body.replaceChildren();
    const done = await renderedActive({ ...ACTIVE, state: "done", endedAt: INITIATIVE.createdAt });
    expect(backToShapingButton(done)).toBeUndefined();
  });

  it("asks first, saying how many Tasks go back to Shaping and how many branches are removed", async () => {
    const fetched = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetched);
    const page = await renderedActive();

    act(() => backToShapingButton(page)?.click());

    expect(fetched.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
    expect(windowShown()?.textContent).toContain(
      "3 Tasks go back to Shaping, out of the queue, their Plans kept but Not confirmed.",
    );
    expect(windowShown()?.textContent).toContain(
      "The Initiative's branch is removed from 2 Projects.",
    );
  });

  it("sends it on the window's button and says so", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...ACTIVE, state: "shaping", branches: [] })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = await renderedActive();
    act(() => backToShapingButton(page)?.click());

    await goBack();

    const [url, request] = fetched.mock.calls.find(([, init]) => init?.method === "POST") ?? [];
    expect(url).toBe(`/api/initiatives/${ACTIVE.id}/back-to-shaping`);
    expect(request?.method).toBe("POST");
    expect(windowShown()).toBeNull();
    expect(document.body.textContent).toContain(
      "Initiative back in Shaping. Its Tasks wait in Shaping until you confirm it again.",
    );
  });

  it("shows every reason it is refused in the window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            {
              message: "Refused",
              reasons: ['Its Task "four" has started.', 'Its Task "four" has a worktree.'],
            },
            { status: 422 },
          ),
        ),
      ),
    );
    const page = await renderedActive();
    act(() => backToShapingButton(page)?.click());

    await goBack();

    const shown = windowShown()?.textContent;
    expect(shown).toContain("The Initiative can't go back to Shaping");
    expect(shown).toContain('Its Task "four" has started.');
    expect(shown).toContain('Its Task "four" has a worktree.');
  });
});
