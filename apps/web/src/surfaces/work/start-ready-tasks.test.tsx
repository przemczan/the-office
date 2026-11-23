import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Initiative, ReadyTasksStarted, Task } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";
import {
  canStartReadyTasks,
  readyTasksStartedWords,
  StartReadyTasksNote,
  useStartReadyTasksAction,
} from "./start-ready-tasks.tsx";
import { RecordActionButton } from "./record-actions.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The action as the head's row shows it. */
function StartReadyTasksButton({
  initiative,
  initiativeTasks,
  onStarted,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly Task[];
  readonly onStarted: (started: ReadyTasksStarted) => void;
}): ReactNode {
  const action = useStartReadyTasksAction(initiative, initiativeTasks, onStarted);
  return action && <RecordActionButton action={action} />;
}

const INITIATIVE: Initiative = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  name: "Usage exports",
  outcome: "Usage can be exported.",
  state: "active",
  originIdeaId: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  projectIds: ["admin-panel"],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-10T09:00:00.000Z",
  endedAt: null,
  archivedAt: null,
  pausedAt: null,
  planningThreadId: null,
  planningAutoMode: false,
  pipelines: [],
  shortName: null,
  engineOverride: null,
  branches: [],
};

const EXPORT_API = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const EXPORT_BUTTON = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const EXPORT_DOCS = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";

const STARTED: ReadyTasksStarted = {
  started: [{ taskId: EXPORT_API, title: "Export API" }],
  queued: [
    {
      taskId: EXPORT_BUTTON,
      title: "Export button",
      place: 2,
      reasons: ['Blocked by "Export API", which must be Done first.'],
    },
  ],
  refused: [
    {
      taskId: EXPORT_DOCS,
      title: "Export docs",
      reasons: ["Nobody fills the Role Implement needs: hire a person for it on People first."],
    },
  ],
};

function aTask(state: Task["state"]): Task {
  return { id: EXPORT_API, title: "Export API", state, initiativeId: INITIATIVE.id } as Task;
}

async function rendered(content: ReactNode): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const router = createRouter({
    routeTree: createRootRoute({ component: () => content }),
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

function startButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find((button) =>
    button.textContent.includes("Start Ready Tasks"),
  );
}

describe("Start Ready Tasks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("is offered only on an active Initiative with a Ready Task", () => {
    expect(canStartReadyTasks(INITIATIVE, [aTask("ready")])).toBe(true);
    expect(canStartReadyTasks(INITIATIVE, [aTask("backlog"), aTask("in-progress")])).toBe(false);
    expect(canStartReadyTasks({ ...INITIATIVE, state: "shaping" }, [aTask("ready")])).toBe(false);
    expect(canStartReadyTasks({ ...INITIATIVE, state: "done" }, [aTask("ready")])).toBe(false);
  });

  it("starts them and hands the answer on, summed up in a toast", async () => {
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(STARTED)));
    vi.stubGlobal("fetch", fetched);
    const onStarted = vi.fn<(started: ReadyTasksStarted) => void>();
    const page = await rendered(
      <StartReadyTasksButton
        initiative={INITIATIVE}
        initiativeTasks={[aTask("ready")]}
        onStarted={onStarted}
      />,
    );

    await act(async () => {
      startButton(page)?.click();
      await new Promise((resolve) => setTimeout(resolve));
    });

    expect(fetched.mock.calls[0]?.[0]).toBe(`/api/initiatives/${INITIATIVE.id}/start`);
    expect(onStarted).toHaveBeenCalledWith(STARTED);
    expect(document.body.textContent).toContain("1 started, 1 queued, 1 refused");
  });

  it("shows the service's refusal of the whole action", async () => {
    const refusal = "None of the Initiative's Tasks is Ready: nothing is left to start.";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(Response.json({ message: refusal }, { status: 422 })),
      ),
    );
    const page = await rendered(
      <StartReadyTasksButton
        initiative={INITIATIVE}
        initiativeTasks={[aTask("ready")]}
        onStarted={() => undefined}
      />,
    );

    await act(async () => {
      startButton(page)?.click();
      await new Promise((resolve) => setTimeout(resolve));
    });

    expect(document.body.textContent).toContain(refusal);
  });

  it("isn't shown without a Ready Task", async () => {
    const page = await rendered(
      <StartReadyTasksButton
        initiative={INITIATIVE}
        initiativeTasks={[aTask("backlog")]}
        onStarted={() => undefined}
      />,
    );

    expect(startButton(page)).toBeUndefined();
  });

  it("lists what started, what was queued and what was refused, each linked to its page", async () => {
    const page = await rendered(
      <StartReadyTasksNote started={STARTED} onClose={() => undefined} />,
    );

    const groups = [...page.querySelectorAll("section")].map((group) => ({
      title: group.querySelector("h3")?.textContent,
      lines: [...group.querySelectorAll("li")].map((line) => line.textContent),
      links: [...group.querySelectorAll("a")].map((link) => link.getAttribute("href")),
    }));
    expect(groups).toEqual([
      { title: "Started", lines: ["Export API"], links: [`/tasks/${EXPORT_API}`] },
      {
        title: "Queued",
        lines: ['Export button · place 2: Blocked by "Export API", which must be Done first.'],
        links: [`/tasks/${EXPORT_BUTTON}`],
      },
      {
        title: "Refused",
        lines: [
          "Export docs: Nobody fills the Role Implement needs: hire a person for it on People first.",
        ],
        links: [`/tasks/${EXPORT_DOCS}`],
      },
    ]);
    expect(page.textContent).toContain("Start Ready Tasks: 1 started, 1 queued, 1 refused");
  });

  it("sums up only the groups that have Tasks", () => {
    expect(readyTasksStartedWords({ ...STARTED, refused: [] })).toBe("1 started, 1 queued");
  });
});
