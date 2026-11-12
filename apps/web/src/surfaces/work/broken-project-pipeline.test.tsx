import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Pipeline,
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
import { asPipeline } from "../../shell/pipelines/use-pipelines.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { PipelineProposal } from "./pipeline-proposal.tsx";
import { PipelineRail } from "./pipeline-rail.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK = {
  id: "0b6c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  title: "Write spec 2.10",
  projectId: "the-office",
  state: "backlog",
  pipelineId: "spec-change",
  proposedPipeline: null,
  initiativeId: null,
} as unknown as Task;

const FULL = {
  id: "full",
  name: "Full",
  description: "",
  stages: [
    { kind: "agent", key: "implement", name: "Implement", optional: false, role: "developer" },
  ],
} as unknown as Pipeline;

const SPEC_CHANGE = {
  id: "spec-change",
  projectId: "the-office",
  name: "Spec change",
  description: "",
  basePipeline: { id: "full", name: "Full" },
  stageChanges: [],
  rows: [],
  stages: FULL.stages,
  broken: [
    {
      stageChangeIndex: 0,
      stageIndex: null,
      stageKey: "produce",
      text: "Changes Produce, which Full no longer has.",
    },
  ],
} as unknown as ProjectPipeline;

const LINUX_CHECK = {
  ...SPEC_CHANGE,
  id: "linux-check",
  name: "Full with Linux check",
  broken: [],
} as unknown as ProjectPipeline;

function stagesOfItsOwn(editedForTask: boolean): TaskStages {
  return {
    stages: null,
    definitionOfDoneMet: [],
    editedForTask,
    lockedStages: 0,
    testResults: [],
  };
}

function rendered(content: ReactNode, { editedForTask = false } = {}): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(pipelineQueries.list().queryKey, [{ ...FULL, builtOnBy: [] }]);
  queryClient.setQueryData(projectPipelineQueries.list(TASK.projectId).queryKey, [
    SPEC_CHANGE,
    LINUX_CHECK,
  ]);
  queryClient.setQueryData(projectPipelineQueries.every().queryKey, [SPEC_CHANGE, LINUX_CHECK]);
  queryClient.setQueryData(
    pipelineQueries.taskStages(TASK.id).queryKey,
    stagesOfItsOwn(editedForTask),
  );
  queryClient.setQueryData(pipelineQueries.stagesCheck(TASK.id, FULL.stages).queryKey, {
    problems: [],
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [] as Role[]);
  queryClient.setQueryData(roleCardQueries.options().queryKey, {} as RoleCardOptions);
  queryClient.setQueryData(projectQueries.one(TASK.projectId).queryKey, {
    id: TASK.projectId,
    name: "the-office",
    defaultPipeline: "full",
    commands: [],
  } as unknown as Project);
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

function rail(task: Task, options?: { readonly editedForTask?: boolean }): HTMLElement {
  return rendered(
    <PipelineRail
      task={task}
      pipeline={asPipeline(SPEC_CHANGE)}
      shown={undefined}
      onSelect={() => undefined}
      onCloseHistory={() => undefined}
    />,
    options,
  );
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((button) =>
    button.textContent.startsWith(name),
  );
}

function optionNamed(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) =>
      document.getElementById(option.getAttribute("aria-labelledby") ?? "")?.textContent === name,
  );
}

describe("a Task on a Broken Project Pipeline", () => {
  afterEach(() => document.body.replaceChildren());

  it("is flagged on the rail with why while it hasn't started", () => {
    const page = rail(TASK);

    const flag = page.querySelector('[role="alert"]') ?? page;
    expect(page.textContent).toContain("Spec change is Broken");
    expect(flag.textContent).toContain(
      "Changes Produce, which Full no longer has. The Task can't start until it is fixed in the-office's Pipelines, or another Pipeline is chosen for it.",
    );
    expect(buttonNamed("Choose another Pipeline")).toBeDefined();
  });

  it("isn't flagged once its Stages were edited for it, nor once it started", () => {
    expect(rail(TASK, { editedForTask: true }).textContent).not.toContain("is Broken");
    document.body.replaceChildren();
    expect(rail({ ...TASK, state: "in-progress" } as Task).textContent).not.toContain("is Broken");
  });

  it("swaps to another the Project can follow from the flag, the Broken one listed but not offered", () => {
    rail(TASK);

    act(() => buttonNamed("Choose another Pipeline")?.click());
    act(() => document.querySelector<HTMLElement>('[role="combobox"]')?.click());

    expect(optionNamed("Spec change")?.getAttribute("aria-disabled")).toBe("true");
    expect(optionNamed("Full with Linux check")?.getAttribute("aria-disabled")).toBeNull();
    expect(optionNamed("Full")?.textContent).toContain("Project default");
  });
});

describe("the Planner's proposal of a Broken Project Pipeline", () => {
  afterEach(() => document.body.replaceChildren());

  it("can't be taken, saying why, and another is offered", () => {
    const proposed = {
      ...TASK,
      state: "planning",
      pipelineId: null,
      proposedPipeline: { pipelineId: "spec-change", reason: "A spec edit." },
    } as unknown as Task;

    const page = rendered(<PipelineProposal task={proposed} pipeline={undefined} />);

    const use = buttonNamed("Use Spec change");
    expect(use?.disabled).toBe(true);
    expect(use?.title).toContain("Broken: Changes Produce, which Full no longer has.");
    expect(page.textContent).toContain("Spec change can't be taken");

    act(() => page.querySelector<HTMLElement>('[aria-label="Another Pipeline"]')?.click());
    const offered = [...document.querySelectorAll('[role="group"]')].map(
      (group) => group.firstElementChild?.textContent,
    );
    expect(offered).toEqual(["the-office's Pipelines", "Office-wide Pipelines"]);
    expect(optionNamed("Spec change")).toBeUndefined();
    expect(optionNamed("Full with Linux check")).toBeDefined();
  });
});
