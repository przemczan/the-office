import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role, Task } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleQueries } from "../../api/people.ts";
import { autoModeQuery } from "../../api/work.ts";
import { aDuty } from "../../shell/duties.fixtures.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { MakeAPlan, PlanOnCardButton, planningNoteWords } from "./planning-actions.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK: Task = {
  id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Remember the sort",
  description: "",
  projectId: "admin-panel",
  priority: "normal",
  tags: [],
  state: "backlog",
  plan: "",
  pausedBy: null,
  resumesAt: null,
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
  madeFor: null,
  projectMoves: [],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-10T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
};

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;

/** Renders `actions` with the Planner hired and the remembered auto mode as given. */
function rendered(actions: ReactNode, rememberedAutoMode: boolean): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(dutyQueries.list().queryKey, [aDuty("plans", "planner")]);
  queryClient.setQueryData(autoModeQuery().queryKey, { autoMode: rememberedAutoMode });
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{actions}</ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return page;
}

function autoModeSwitch(page: HTMLElement): HTMLElement | null {
  return page.querySelector('[role="switch"]');
}

/** Clicks the button whose words start with `name`, then lets the request go out. */
async function press(page: HTMLElement, name: string): Promise<void> {
  const button = [...page.querySelectorAll("button")].find((found) =>
    (found.getAttribute("aria-label") ?? found.textContent).startsWith(name),
  );
  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve));
  });
}

function stubMakeAPlan() {
  const fetched = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json({ ...TASK, state: "planning" })),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

describe("Make a plan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("starts its Auto mode switch at the remembered default", () => {
    expect(autoModeSwitch(rendered(<MakeAPlan task={TASK} />, true))?.ariaChecked).toBe("true");
    document.body.replaceChildren();
    expect(autoModeSwitch(rendered(<MakeAPlan task={TASK} />, false))?.ariaChecked).toBe("false");
  });

  it("sends the switch's choice with the request", async () => {
    const fetched = stubMakeAPlan();
    const page = rendered(<MakeAPlan task={TASK} />, false);

    act(() => autoModeSwitch(page)?.click());
    await press(page, "Make a plan");

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/tasks/${TASK.id}/make-a-plan`);
    expect(request?.body).toBe(JSON.stringify({ autoMode: true }));
  });

  it("says a Task planning in auto mode won't wait for the user's Confirm", () => {
    const planning: Task = { ...TASK, state: "planning" };

    expect(planningNoteWords(planning, "Angela")).toBe("Planning with Angela");
    expect(planningNoteWords({ ...planning, autoMode: true }, "Angela")).toBe(
      "Planning with Angela, in auto mode",
    );
  });

  it("plans from the board card in the remembered auto mode", async () => {
    const fetched = stubMakeAPlan();
    const page = rendered(<PlanOnCardButton task={TASK} />, true);

    await press(page, "Plan");

    expect(fetched.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ autoMode: true }));
  });
});
