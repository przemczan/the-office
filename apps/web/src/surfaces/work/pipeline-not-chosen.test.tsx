import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Pipeline,
  Project,
  Role,
  RoleCardOptions,
  Task,
  TaskStages,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { PipelineProposal } from "./pipeline-proposal.tsx";
import { PipelineRail } from "./pipeline-rail.tsx";
import { HeadPipeline } from "./task-page.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
] as unknown as Pipeline[];

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
  queryClient.setQueryData(pipelineQueries.taskStages(TASK.id).queryKey, NO_STAGES_OF_ITS_OWN);
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(roleCardQueries.options().queryKey, {} as RoleCardOptions);
  queryClient.setQueryData(projectQueries.one(TASK.projectId).queryKey, {
    id: TASK.projectId,
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

  it("chooses one in Backlog, the Project's default listed first", () => {
    rail(TASK);

    act(() => buttonNamed("Choose a Pipeline")?.click());

    const choices = [...document.querySelectorAll("option")].map(({ textContent }) => textContent);
    expect(choices.filter((choice) => choice !== "Choose a Pipeline")).toEqual([
      "Quick fix (Project default)",
      "Full",
    ]);
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
