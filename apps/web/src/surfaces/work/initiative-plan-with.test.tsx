import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { Initiative, Role, Task } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleQueries } from "../../api/people.ts";
import { taskQueries } from "../../api/work.ts";
import { aDuty } from "../../shell/duties.fixtures.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import {
  PlanInitiativeWith,
  planningWithWords,
  usePlanWithAction,
} from "./initiative-plan-with.tsx";
import { RecordActionButton } from "./record-actions.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE: Initiative = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  name: "Usage exports",
  outcome: "Usage can be exported.",
  state: "active",
  originIdeaId: null,
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
  branches: [],
};

const PLANNING_THREAD = "8a7b6c5d-4e3f-4a1b-9c0d-1e2f3a4b5c6d";

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;

function aTask(fields: Partial<Task> = {}): Task {
  return {
    id: "7c6b5a4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d",
    title: "Export API",
    state: "backlog",
    initiativeId: INITIATIVE.id,
    ...fields,
  } as Task;
}

/** The action as the head's row shows it. */
function PlanWithAction({
  initiative,
  initiativeTasks,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly Task[];
}): ReactNode {
  const action = usePlanWithAction(initiative, initiativeTasks);
  return action && <RecordActionButton action={action} />;
}

async function rendered(
  shown: ReactNode,
  tasks: readonly Task[],
): Promise<{ page: HTMLElement; location: () => string }> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(dutyQueries.list().queryKey, [aDuty("plans", "planner")]);
  queryClient.setQueryData(taskQueries.list().queryKey, [...tasks]);
  const root = createRootRoute({
    component: () => (
      <>
        {shown}
        <Outlet />
      </>
    ),
  });
  const initiativePage = createRoute({
    getParentRoute: () => root,
    path: "/work/initiatives/$initiativeId",
  });
  const router = createRouter({
    routeTree: root.addChildren([initiativePage]),
    history: createMemoryHistory({ initialEntries: [`/work/initiatives/${INITIATIVE.id}`] }),
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
  return { page, location: () => router.state.location.href };
}

function planWithButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find((button) =>
    button.textContent.includes("Plan with Angela"),
  );
}

async function clicked(button: HTMLButtonElement | undefined): Promise<void> {
  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve));
  });
}

describe("Plan with… on an Initiative", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("opens the planning Thread waiting for the user and goes to it in the conversation", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...INITIATIVE, planningThreadId: PLANNING_THREAD })),
    );
    vi.stubGlobal("fetch", fetched);
    const { page, location } = await rendered(
      <PlanWithAction initiative={INITIATIVE} initiativeTasks={[aTask()]} />,
      [],
    );

    await clicked(planWithButton(page));

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/plan-with`);
    expect(request?.method).toBe("POST");
    expect(location()).toContain(`initiativeThread=${PLANNING_THREAD}`);
    expect(document.body.textContent).toContain(planningWithWords("Angela"));
  });

  it("shows the service's refusal", async () => {
    const refusal = "Only an active Initiative is planned; this one is paused.";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(Response.json({ message: refusal }, { status: 409 })),
      ),
    );
    const { page } = await rendered(
      <PlanWithAction initiative={INITIATIVE} initiativeTasks={[aTask()]} />,
      [],
    );

    await clicked(planWithButton(page));

    expect(document.body.textContent).toContain(refusal);
  });

  it("is offered as Plan the Initiative is: on an active Initiative with a Task in Backlog", async () => {
    const offered = await rendered(
      <PlanWithAction initiative={INITIATIVE} initiativeTasks={[aTask()]} />,
      [],
    );
    expect(planWithButton(offered.page)).toBeDefined();
    document.body.replaceChildren();

    const noBacklog = await rendered(
      <PlanWithAction initiative={INITIATIVE} initiativeTasks={[aTask({ state: "ready" })]} />,
      [],
    );
    expect(planWithButton(noBacklog.page)).toBeUndefined();
    document.body.replaceChildren();

    const shaping = await rendered(
      <PlanWithAction
        initiative={{ ...INITIATIVE, state: "shaping" }}
        initiativeTasks={[aTask()]}
      />,
      [],
    );
    expect(planWithButton(shaping.page)).toBeUndefined();
  });

  it("is in the Planner's empty tab while it is offered, from the Initiative's Tasks", async () => {
    const offered = await rendered(
      <PlanInitiativeWith initiative={INITIATIVE} planner="Angela" />,
      [aTask()],
    );
    expect(planWithButton(offered.page)).toBeDefined();
    document.body.replaceChildren();

    const nothingToPlan = await rendered(
      <PlanInitiativeWith initiative={INITIATIVE} planner="Angela" />,
      [aTask({ state: "ready" })],
    );
    expect(planWithButton(nothingToPlan.page)).toBeUndefined();
  });
});
