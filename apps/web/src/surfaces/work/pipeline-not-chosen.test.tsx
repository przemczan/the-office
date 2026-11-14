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
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleCardQueries, roleQueries } from "../../api/people.ts";
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
  createdBy: { kind: "user", user: null },
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
    stages: [
      {
        kind: "agent",
        key: "implement",
        name: "Implement",
        optional: false,
        role: "developer",
        brief: "Implement the Plan.",
        session: "fresh",
        budget: 100000,
      },
      {
        kind: "script",
        key: "sort-check",
        name: "Sort check",
        optional: false,
        command: "test",
        onFailure: undefined,
      },
    ],
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
  queryClient.setQueryData(dutyQueries.list().queryKey, []);
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

/** The Stages the dialog's Stage editor shows, by name. */
function stageNames(): (string | null)[] {
  return [...document.querySelectorAll('[role="dialog"] [aria-label="Stages"] > li')].map((row) =>
    row.getAttribute("aria-label"),
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
    const save = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[title="Choose a Pipeline first."]',
    );
    expect(save?.disabled).toBe(true);
    expect(document.querySelector('[role="dialog"] [aria-label="Stages"]')).toBeNull();
  });

  it("shows the chosen Pipeline's Stages to edit at once, checked against it, and Save sets the Pipeline then the Stages", async () => {
    const requests: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({
          method,
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.endsWith("/stages/check")) return Promise.resolve(Response.json({ problems: [] }));
        if (url.endsWith("/pipeline")) {
          return Promise.resolve(Response.json({ ...TASK, pipelineId: "sort-check" }));
        }
        return Promise.resolve(Response.json({ ...NO_STAGES_OF_ITS_OWN, editedForTask: true }));
      }),
    );
    rail(TASK);
    act(() => buttonNamed("Choose a Pipeline")?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      `Choose a Pipeline for ${TASK.title}`,
    );
    act(() => document.querySelector<HTMLElement>('[role="combobox"]')?.click());
    act(() => optionNamed("Full with sort check")?.click());

    expect(stageNames()).toEqual(["Implement", "Sort check"]);

    act(() =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Remove Sort check"]')?.click(),
    );
    expect(stageNames()).toEqual(["Implement"]);
    // Save waits for the edited draft's check to answer.
    await act(async () => {
      await vi.waitFor(() => expect(buttonNamed("Save for this Task")?.disabled).toBe(false));
    });
    const lastCheck = requests.filter(({ url }) => url.endsWith("/stages/check")).at(-1);
    expect(lastCheck?.body).toMatchObject({
      pipelineId: "sort-check",
      stages: [{ key: "implement" }],
    });

    await act(async () => {
      buttonNamed("Save for this Task")?.click();
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain(`${TASK.title} follows Full with sort check.`),
      );
    });

    expect(
      requests.filter(({ method }) => method === "PUT").map(({ url, body }) => [url, body]),
    ).toEqual([
      [`/api/tasks/${TASK.id}/pipeline`, { pipelineId: "sort-check" }],
      [`/api/tasks/${TASK.id}/stages`, { stages: [expect.objectContaining({ key: "implement" })] }],
    ]);
    vi.unstubAllGlobals();
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
