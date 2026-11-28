import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  OfficeWidePipeline,
  Project,
  RoleCardOptions,
  Stage,
  StageRun,
  TaskStages,
  TaskSummary,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleCardQueries, roleQueries } from "../../api/people.ts";
import { pipelineQueries, projectPipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { EditTaskStagesDialog } from "./edit-task-stages-dialog.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A Task started over, Paused again in its first Stage's new run. */
const TASK = {
  id: "5e1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Remember the sort",
  projectId: "admin-panel",
  state: "paused",
  pipelineId: "full",
  kind: "feature",
} as TaskSummary;

const IMPLEMENT: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Build it.",
  session: "fresh",
  budget: 100_000,
  position: { x: 0, y: 0 },
  routes: [{ to: "tests", condition: null }],
};
const TESTS: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  position: { x: 308, y: 0 },
  routes: [{ to: null, condition: null }],
};

function aRun(number: number, earlierStart: boolean): StageRun {
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
    earlierStart,
    gateAction: null,
    commandRuns: [],
    outcome: null,
  };
}

/** Both Stages ran before the Start over; only Implement has run since. */
const STARTED_OVER: TaskStages = {
  stages: [
    {
      stage: IMPLEMENT,
      state: "paused",
      tokens: NO_TOKENS,
      wentBack: null,
      runs: [aRun(1, true), aRun(3, false)],
    },
    { stage: TESTS, state: "pending", tokens: NO_TOKENS, wentBack: null, runs: [aRun(2, true)] },
  ],
  definitionOfDoneMet: [],
  definitionOfDoneOutOfReach: [],
  gatesCheckingDefinitionOfDone: [],
  editedForTask: false,
  lockedStages: 1,
  testResults: [],
};

const LIBRARY = [
  { id: "full", name: "Full", description: "", stages: [IMPLEMENT, TESTS] },
] as unknown as OfficeWidePipeline[];

const PROJECT = {
  id: "admin-panel",
  name: "Admin panel",
  defaultPipeline: "full",
  kindDefaultPipelines: { feature: null, bug: null, chore: null },
  defaultPipelineOfKind: { feature: "full", bug: "full", chore: "full" },
  commands: [{ key: "test", name: "Test" }],
} as unknown as Project;

let root: Root | undefined;

function open(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(pipelineQueries.list().queryKey, LIBRARY);
  queryClient.setQueryData(projectPipelineQueries.list(TASK.projectId).queryKey, []);
  queryClient.setQueryData(pipelineQueries.taskStages(TASK.id).queryKey, STARTED_OVER);
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  queryClient.setQueryData(dutyQueries.list().queryKey, []);
  queryClient.setQueryData(roleCardQueries.options().queryKey, {
    knownRoles: [],
  } as unknown as RoleCardOptions);
  queryClient.setQueryData(projectQueries.one(TASK.projectId).queryKey, PROJECT);
  const page = document.createElement("div");
  document.body.append(page);
  act(() => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <EditTaskStagesDialog task={TASK} onClose={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter(
    (button) => button.getAttribute("aria-label") === name,
  );
}

function lock(note: string): Element | null {
  return document.querySelector(`[aria-label="Flow"] [role="img"][aria-label="${note}"]`);
}

describe("Edit for this Task, after a Start over", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ problems: [] }))),
    );
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("locks only the Stages run since, those of the earlier start left to edit", () => {
    open();

    expect(document.body.textContent).toContain(
      "Started Stages, and the routes out of them, are locked.",
    );
    expect(lock("Paused: started, so it can't be changed")).not.toBeNull();
    expect(buttonsNamed("Draw a route from Implement")).toEqual([]);
    expect(lock("Pending: started, so it can't be changed")).toBeNull();
    expect(buttonsNamed("Draw a route from Tests")).toHaveLength(1);
  });
});
