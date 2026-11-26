import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role, Stage, StageRun, Task, TaskStage, TaskStages } from "@the-office/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { dutyQueries, roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { PipelineDiagramWindow } from "./pipeline-diagram-window.tsx";
import { PipelineRail } from "./pipeline-rail.tsx";
import { REMOVED_PIPELINE } from "./stage-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const TASK = {
  id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Remember the sort",
  projectId: "admin-panel",
  state: "in-progress",
  pipelineId: "full",
  proposedPipeline: null,
  kind: "feature",
} as unknown as Task;

const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Do it.",
  session: "fresh",
  budget: 100000,
};
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  routes: [
    {
      to: "implement",
      condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
      limit: 3,
    },
    { to: null, condition: null, limit: null },
  ],
};
const review: Stage = { kind: "gate", key: "review", name: "Review", optional: false };

function aRun(number: number, fields: Partial<StageRun> = {}): StageRun {
  return {
    id: `8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e${number.toString().padStart(2, "0")}`,
    number,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: "2026-10-26T10:18:00.000Z",
    waitingSince: null,
    threadId: null,
    session: null,
    engine: null,
    engineSwitches: [],
    tokens: NO_TOKENS,
    context: null,
    carriedFailure: null,
    route: null,
    choice: null,
    sentBack: null,
    restart: null,
    restarted: null,
    startedOver: null,
    earlierStart: false,
    gateAction: null,
    commandRuns: [],
    outcome: null,
    ...fields,
  };
}

/** The walk: Implement, Tests (failed, back), Implement again and running; Review ahead. */
const LOOPED: TaskStage[] = [
  {
    stage: implement,
    state: "running",
    tokens: NO_TOKENS,
    wentBack: null,
    runs: [aRun(1, { route: { to: "tests", times: 1, limit: null } }), aRun(3, { endedAt: null })],
  },
  {
    stage: tests,
    state: "done",
    tokens: NO_TOKENS,
    wentBack: null,
    runs: [aRun(2, { route: { to: "implement", times: 1, limit: 3 } })],
  },
  { stage: review, state: "pending", tokens: NO_TOKENS, wentBack: null, runs: [] },
];

async function rendered(content: ReactNode): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const stages: TaskStages = {
    stages: LOOPED,
    definitionOfDoneMet: [],
    definitionOfDoneOutOfReach: [],
    gatesCheckingDefinitionOfDone: [],
    editedForTask: true,
    lockedStages: 0,
    testResults: [],
  };
  queryClient.setQueryData(pipelineQueries.taskStages(TASK.id).queryKey, stages);
  queryClient.setQueryData(roleQueries.list().queryKey, [
    { key: "developer", letGoAt: null, card: { name: "Jim" } } as unknown as Role,
  ]);
  queryClient.setQueryData(dutyQueries.list().queryKey, []);
  const page = document.createElement("div");
  document.body.append(page);
  const router = createRouter({
    routeTree: createRootRoute({ component: () => content }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
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

describe("the Pipeline rail's progress", () => {
  afterEach(() => document.body.replaceChildren());

  it("shows a Stage the work came back to once, with its round, tagged Now, and Open diagram", async () => {
    const onOpenDiagram = vi.fn<() => void>();
    const onSelect = vi.fn<(stageKey: string) => void>();
    const page = await rendered(
      <PipelineRail
        task={TASK}
        pipeline={undefined}
        shown={undefined}
        onSelect={onSelect}
        onCloseHistory={() => undefined}
        onOpenDiagram={onOpenDiagram}
      />,
    );

    const stageItems = [...page.querySelectorAll('[aria-label="Stages"] > li')];
    expect(stageItems).toHaveLength(3);
    expect(stageItems[0]?.textContent).toContain("Implement");
    expect(stageItems[0]?.textContent).toContain("Now");
    expect(stageItems[0]?.textContent).toContain("Round 2 of ≤4");
    expect(stageItems[1]?.textContent).toContain("Tests");
    expect(stageItems[2]?.classList.contains("pipeline-rail-stage-ahead")).toBe(true);

    act(() => stageItems[1]?.querySelector("button")?.click());
    expect(onSelect).toHaveBeenCalledWith("tests");

    const open = [...page.querySelectorAll("button")].find(({ textContent }) =>
      textContent.includes("Open diagram"),
    );
    act(() => open?.click());
    expect(onOpenDiagram).toHaveBeenCalledOnce();
  });
});

async function openedDiagram(): Promise<{ onOpenStageHistory: Mock<(stageKey: string) => void> }> {
  const onOpenStageHistory = vi.fn<(stageKey: string) => void>();
  await rendered(
    <PipelineDiagramWindow
      task={TASK}
      pipeline={undefined}
      onOpenStageHistory={onOpenStageHistory}
      onClose={() => undefined}
    />,
  );
  return { onOpenStageHistory };
}

describe("the Pipeline diagram window", () => {
  afterEach(() => document.body.replaceChildren());

  it("draws the Pipeline read only, with a legend and the walk beside it", async () => {
    await openedDiagram();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(`Pipeline diagram: ${REMOVED_PIPELINE}`);
    expect(dialog?.textContent).toContain("At Implement: running");
    expect(dialog?.querySelector('[aria-label="Legend"]')?.textContent).toContain("Waiting on you");
    expect(dialog?.querySelectorAll(".flow-canvas-stage-pick")).toHaveLength(3);
    const walk = dialog?.querySelector('[aria-label="The walk"]');
    expect(walk?.children).toHaveLength(3);
    expect(walk?.children[1]?.textContent).toBe("Tests · Went back to Implement (1 of at most 3)");
    expect(walk?.children[2]?.textContent).toBe("Implement · Round 2");
  });

  it("picks a Stage by a step of the walk", async () => {
    await openedDiagram();
    const step = document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="The walk"] .pipeline-diagram-step',
    )[1];
    act(() => step?.click());
    expect(step?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".pipeline-diagram-picked h3")?.textContent).toBe("Tests");
  });

  it("shows the Stage pressed, with the way to its Stage history", async () => {
    const { onOpenStageHistory } = await openedDiagram();
    const card = document.querySelector<HTMLElement>(
      '[role="dialog"] .flow-canvas-stage-pick[aria-label^="Tests"]',
    );
    act(() => card?.click());
    const side = document.querySelector('[aria-label="Walk"]');
    expect(side?.textContent).toContain("Tests");
    const history = [...(side?.querySelectorAll("button") ?? [])].find(({ textContent }) =>
      textContent.includes("Open Stage history"),
    );
    act(() => history?.click());
    expect(onOpenStageHistory).toHaveBeenCalledWith("tests");
  });
});
