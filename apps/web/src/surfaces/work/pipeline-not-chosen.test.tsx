import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  OfficeWidePipeline,
  Project,
  ProjectPipeline,
  Role,
  RoleCardOptions,
  Task,
  TaskStages,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { pipelineQueries, projectPipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { PipelineProposal } from "./pipeline-proposal.tsx";
import { PipelineRail } from "./pipeline-rail.tsx";
import { HeadPipeline } from "./task-page.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the Pipeline picker's list, placed by its size, never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

/** A Task created a moment ago: no Pipeline until one is chosen. */
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
  pipelineId: null,
  proposedPipeline: null,
  blockedBy: [],
  originIdeaId: null,
  initiativeId: null,
  madeFor: null,
  projectMoves: [],
  createdBy: { kind: "user" },
  createdAt: "2026-11-11T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
};

const LIBRARY = [
  { id: "full", name: "Full", description: "", stages: [{ name: "Implement" }] },
  { id: "quick-fix", name: "Quick fix", description: "", stages: [{ name: "Implement" }] },
] as unknown as OfficeWidePipeline[];

/** The Task's Project's own Pipelines, one Broken, and another Project's, which is never offered. */
const PROJECT_PIPELINES = [
  {
    id: "sort-check",
    projectId: "admin-panel",
    name: "Full with sort check",
    basePipeline: { id: "full", name: "Full" },
    stages: [{ name: "Implement" }, { name: "Sort check" }],
    broken: [],
  },
  {
    id: "spec-change",
    projectId: "admin-panel",
    name: "Spec change",
    basePipeline: { id: "full", name: "Full" },
    stages: [{ name: "Implement" }],
    broken: [{ text: "Changes Produce, which Full no longer has." }],
  },
  {
    id: "elsewhere",
    projectId: "engine-shop",
    name: "Engine shop's own",
    basePipeline: { id: "full", name: "Full" },
    stages: [{ name: "Implement" }],
    broken: [],
  },
] as unknown as ProjectPipeline[];

const NO_STAGES_OF_ITS_OWN: TaskStages = {
  stages: null,
  definitionOfDoneMet: [],
  editedForTask: false,
  lockedStages: 0,
  testResults: [],
};

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;

/** Renders `content` with the library, the Planner and the Task's Project read already. */
function rendered(content: ReactNode): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(pipelineQueries.list().queryKey, LIBRARY);
  queryClient.setQueryData(
    projectPipelineQueries.list(TASK.projectId).queryKey,
    PROJECT_PIPELINES.filter(({ projectId }) => projectId === TASK.projectId),
  );
  queryClient.setQueryData(projectPipelineQueries.every().queryKey, PROJECT_PIPELINES);
  queryClient.setQueryData(pipelineQueries.taskStages(TASK.id).queryKey, NO_STAGES_OF_ITS_OWN);
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(roleCardQueries.options().queryKey, {} as RoleCardOptions);
  queryClient.setQueryData(projectQueries.one(TASK.projectId).queryKey, {
    id: TASK.projectId,
    name: "Admin panel",
    defaultPipeline: "quick-fix",
  } as Project);
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{content}</ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return page;
}

function rail(task: Task): HTMLElement {
  return rendered(
    <PipelineRail
      task={task}
      pipeline={undefined}
      shown={undefined}
      onSelect={() => undefined}
      onCloseHistory={() => undefined}
    />,
  );
}

function labelOf(option: Element): string | undefined {
  return document.getElementById(option.getAttribute("aria-labelledby") ?? "")?.textContent;
}

function optionNamed(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => labelOf(option) === name,
  );
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((button) =>
    button.textContent.startsWith(name),
  );
}

describe("a Task with no Pipeline yet", () => {
  afterEach(() => document.body.replaceChildren());

  it("shows a placeholder rail with no Stages, saying the Planner proposes one", () => {
    const page = rail({ ...TASK, state: "planning" });

    expect(page.querySelector('[aria-label="Pipeline · Not chosen yet"]')).not.toBeNull();
    expect(page.textContent).toContain(
      "Pipeline not chosen yet. The Planner proposes one while planning.",
    );
    expect(page.querySelector('[aria-label="Stages"]')).toBeNull();
    expect(page.textContent).not.toContain("removed from the library");
    expect(buttonNamed("Choose a Pipeline")).toBeUndefined();
  });

  it("chooses one in Backlog: the Project's own first, then the office-wide ones, the default marked", () => {
    rail(TASK);

    act(() => buttonNamed("Choose a Pipeline")?.click());
    act(() => document.querySelector<HTMLElement>('[role="combobox"]')?.click());

    const groups = [...document.querySelectorAll('[role="listbox"] [role="group"]')].map(
      (group) => [
        group.firstElementChild?.textContent,
        [...group.querySelectorAll('[role="option"]')].map(labelOf),
      ],
    );
    expect(groups).toEqual([
      ["Admin panel's Pipelines", ["Full with sort check", "Spec change"]],
      ["Office-wide Pipelines", ["Quick fix", "Full"]],
    ]);
    expect(optionNamed("Quick fix")?.textContent).toContain("Project default");
  });

  it("lists a Broken Project Pipeline with why, and doesn't choose it", () => {
    rail(TASK);
    act(() => buttonNamed("Choose a Pipeline")?.click());
    act(() => document.querySelector<HTMLElement>('[role="combobox"]')?.click());

    const broken = optionNamed("Spec change");
    expect(broken?.getAttribute("aria-disabled")).toBe("true");
    expect(broken?.textContent).toContain(
      "BrokenBroken: Changes Produce, which Full no longer has. Fix it in Admin panel's Pipelines.",
    );
    act(() => broken?.click());

    expect(document.querySelector('[role="combobox"]')?.textContent).toBe("Choose a Pipeline");
    const choose = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[title="Choose a Pipeline first."]',
    );
    expect(choose?.disabled).toBe(true);
  });

  it("reads Not chosen yet in the head, never removed", () => {
    const page = rendered(<HeadPipeline task={TASK} pipeline={undefined} editedForTask={false} />);

    expect(page.textContent).toBe("Pipeline Not chosen yet");
  });

  it("offers the proposed Pipeline or another, with none to keep", () => {
    const proposed: Task = {
      ...TASK,
      state: "planning",
      proposedPipeline: { pipelineId: "quick-fix", reason: "One small change." },
    };

    const page = rendered(<PipelineProposal task={proposed} pipeline={undefined} />);

    expect(buttonNamed("Use Quick fix")).toBeDefined();
    expect(buttonNamed("Keep")).toBeUndefined();
    expect(page.querySelector('[aria-label="Another Pipeline"]')).not.toBeNull();
  });
});
