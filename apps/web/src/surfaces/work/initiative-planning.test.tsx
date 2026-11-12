import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Initiative, Role, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { autoModeQuery } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { PlanTheInitiative } from "./initiative-actions.tsx";
import {
  PLANNING_STEP_WORDS,
  canPlanInitiative,
  planningProgressWords,
  planningStepOf,
} from "./initiative-planning-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE: Initiative = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  name: "Usage exports",
  outcome: "Usage can be exported.",
  state: "active",
  originIdeaId: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  projectIds: ["admin-panel"],
  createdBy: { kind: "user" },
  createdAt: "2026-11-10T09:00:00.000Z",
  endedAt: null,
  archivedAt: null,
  pausedAt: null,
  planningThreadId: null,
  planningAutoMode: false,
  pipelineId: null,
  shortName: null,
  branches: [],
};

const PLANNING_THREAD = "8a7b6c5d-4e3f-4a1b-9c0d-1e2f3a4b5c6d";

function aTask(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    projectId: "admin-panel",
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
    initiativeId: INITIATIVE.id,
    madeFor: null,
    projectMoves: [],
    createdBy: { kind: "user" },
    createdAt: "2026-11-10T10:00:00.000Z",
    archivedAt: null,
    endedAt: null,
    ...fields,
  };
}

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;

function rendered(tasks: readonly Task[], rememberedAutoMode: boolean): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(autoModeQuery().queryKey, { autoMode: rememberedAutoMode });
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <PlanTheInitiative initiative={INITIATIVE} initiativeTasks={tasks} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return page;
}

function autoModeSwitch(page: HTMLElement): HTMLElement | null {
  return page.querySelector('[role="switch"]');
}

function planButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find((button) =>
    button.textContent.startsWith("Plan the Initiative"),
  );
}

describe("Plan the Initiative", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("starts its Auto mode switch at the remembered default", () => {
    expect(autoModeSwitch(rendered([aTask("a")], true))?.ariaChecked).toBe("true");
    document.body.replaceChildren();
    expect(autoModeSwitch(rendered([aTask("a")], false))?.ariaChecked).toBe("false");
  });

  it("sends the switch's choice and shows the service's refusal", async () => {
    const refusal = "None of the Initiative's Tasks is in Backlog: nothing is left to plan.";
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ message: refusal }, { status: 409 })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = rendered([aTask("a")], false);

    act(() => autoModeSwitch(page)?.click());
    await act(async () => {
      planButton(page)?.click();
      await new Promise((resolve) => setTimeout(resolve));
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/planning`);
    expect(request?.body).toBe(JSON.stringify({ autoMode: true }));
    expect(document.body.textContent).toContain(refusal);
  });

  it("is offered only on an active Initiative with a Task in Backlog", () => {
    expect(planButton(rendered([aTask("a", { state: "ready" })], false))).toBeUndefined();
    expect(canPlanInitiative(INITIATIVE, [aTask("a")])).toBe(true);
    expect(canPlanInitiative({ ...INITIATIVE, state: "shaping" }, [aTask("a")])).toBe(false);
    expect(canPlanInitiative(INITIATIVE, [aTask("a", { state: "planning" })])).toBe(false);
  });
});

describe("the planning progress", () => {
  const planned = { ...INITIATIVE, planningThreadId: PLANNING_THREAD };
  const tasks = [
    aTask("waiting"),
    aTask("planning", { state: "planning", initiativePlanningThreadId: PLANNING_THREAD }),
    aTask("planned", {
      state: "planning",
      initiativePlanningThreadId: PLANNING_THREAD,
      markedPlanned: true,
    }),
    aTask("ready", { state: "ready", markedPlanned: true }),
    aTask("started", { state: "in-progress" }),
  ];

  it("names each Task's step while the Initiative has a planning Thread", () => {
    expect(tasks.map((task) => planningStepOf(planned, task, []))).toEqual([
      "waiting",
      "planning",
      "planned",
      "ready",
      undefined,
    ]);
    expect(PLANNING_STEP_WORDS.planned).toBe("Planned, waiting for your Confirm");
  });

  it("sums it up in the head", () => {
    expect(planningProgressWords(planned, tasks, [])).toBe("2 of 4 Tasks planned");
  });

  it("says nothing before the Initiative is planned", () => {
    expect(planningStepOf(INITIATIVE, tasks[0] as Task, [])).toBeUndefined();
    expect(planningProgressWords(INITIATIVE, tasks, [])).toBeUndefined();
  });
});
