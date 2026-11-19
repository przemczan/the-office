import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Readiness, Role, Task } from "@the-office/contracts";
import { act, Fragment, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleQueries } from "../../api/people.ts";
import { autoModeQuery, taskQueries } from "../../api/work.ts";
import { aDuty } from "../../shell/duties.fixtures.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import {
  MakeAPlan,
  PlanOnCardButton,
  planningNoteWords,
  usePlanningActions,
} from "./planning-actions.tsx";
import { RecordActionButton } from "./record-actions.tsx";

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
  engineStandIns: [],
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
  createdAt: "2026-11-10T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
  pullRequestEnd: null,
};

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;

/**
 * Renders `actions` with the Planner hired and the remembered auto mode as given, and the Task's
 * "Before Ready" checklist when given.
 */
function rendered(
  actions: ReactNode,
  rememberedAutoMode: boolean,
  readiness?: Readiness,
): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  if (readiness) queryClient.setQueryData(taskQueries.readiness(TASK.id).queryKey, readiness);
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

/** The Task's planning actions as its page's head shows them, with the window an action opens. */
function PlanningActions({ task }: { readonly task: Task }): ReactNode {
  return usePlanningActions(task).map((action) => (
    <Fragment key={action.key}>
      <RecordActionButton action={action} />
      {action.dialog}
    </Fragment>
  ));
}

/** A checklist with every line met but those named. */
function readinessWith(...unmet: Readiness["lines"][number]["part"][]): Readiness {
  const parts = ["plan", "definition-of-done", "pipeline", "decisions"] as const;
  return {
    lines: parts.map((part) => ({ part, label: part, met: !unmet.includes(part), problems: [] })),
  };
}

function markReadyButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find(
    // A button's text is followed by its spinner's style.
    (found) =>
      found.textContent.startsWith("Mark Ready") &&
      !found.textContent.startsWith("Mark Ready anyway"),
  );
}

function dialog(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]');
}

/** Clicks the window's button with these words, then lets the request go out. */
async function pressInDialog(name: string): Promise<void> {
  const button = [...(dialog()?.querySelectorAll("button") ?? [])].find(
    // A button's text is followed by its spinner's style.
    (found) => found.textContent.startsWith(name),
  );
  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve));
  });
}

function stubMarkReady() {
  const fetched = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json({ ...TASK, state: "ready" })),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

function markReadyCalls(fetched: ReturnType<typeof stubMarkReady>) {
  return fetched.mock.calls.filter(([url]) => url === `/api/tasks/${TASK.id}/ready`);
}

describe("Mark Ready", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  const planning: Task = { ...TASK, state: "planning" };

  it("marks Ready at once when every line of Before Ready is met", async () => {
    const fetched = stubMarkReady();
    const page = rendered(<PlanningActions task={planning} />, false, readinessWith());

    await press(page, "Mark Ready");

    expect(dialog()).toBeNull();
    expect(markReadyCalls(fetched)[0]?.[1]?.body).toBe(JSON.stringify({}));
  });

  it("asks first, naming what isn't written or confirmed, when the Plan or the Definition of Done isn't confirmed", async () => {
    const fetched = stubMarkReady();
    const page = rendered(
      <PlanningActions
        task={{ ...planning, plan: "", definitionOfDone: ["The sort is remembered"] }}
      />,
      false,
      readinessWith("plan", "definition-of-done"),
    );

    await press(page, "Mark Ready");

    expect(dialog()?.textContent).toContain(
      "The Plan isn't written. The Definition of Done isn't confirmed.",
    );
    expect(markReadyCalls(fetched)).toHaveLength(0);
  });

  it("confirms the Plan and the Definition of Done as they stand with Mark Ready anyway", async () => {
    const fetched = stubMarkReady();
    const page = rendered(
      <PlanningActions task={{ ...planning, plan: "Keep the sort" }} />,
      false,
      readinessWith("plan"),
    );

    await press(page, "Mark Ready");
    expect(dialog()?.textContent).toContain("The Plan isn't confirmed.");
    expect(dialog()?.textContent).not.toContain("Definition of Done isn't");
    await pressInDialog("Mark Ready anyway");

    expect(markReadyCalls(fetched)[0]?.[1]?.body).toBe(
      JSON.stringify({ confirmPlanAndDefinitionOfDone: true }),
    );
    expect(dialog()).toBeNull();
  });

  it("changes nothing when the window is closed", async () => {
    const fetched = stubMarkReady();
    const page = rendered(
      <PlanningActions task={planning} />,
      false,
      readinessWith("definition-of-done"),
    );

    await press(page, "Mark Ready");
    expect(dialog()?.textContent).toContain("The Definition of Done isn't written.");
    await pressInDialog("Close");

    expect(dialog()).toBeNull();
    expect(markReadyCalls(fetched)).toHaveLength(0);
  });

  it("is offered in Backlog once a Pipeline is chosen and no Decision is open, the Plan unconfirmed", () => {
    const page = rendered(<PlanningActions task={TASK} />, false, readinessWith("plan"));

    expect(markReadyButton(page)?.disabled).toBe(false);
  });

  it("is disabled in Planning, and not offered in Backlog, without a Pipeline or with a Decision open", () => {
    for (const unmet of ["pipeline", "decisions"] as const) {
      const inPlanning = rendered(<PlanningActions task={planning} />, false, readinessWith(unmet));
      expect(markReadyButton(inPlanning)?.disabled).toBe(true);
      document.body.replaceChildren();
      const inBacklog = rendered(<PlanningActions task={TASK} />, false, readinessWith(unmet));
      expect(markReadyButton(inBacklog)).toBeUndefined();
      document.body.replaceChildren();
    }
  });
});
