import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OfficeWidePipeline, Project, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { MoveTaskDialog } from "./move-task-dialog.tsx";
import { TaskMenu } from "./task-menu.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK: Task = {
  id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Fix the login redirect",
  description: "",
  projectId: "admin-panel",
  priority: "normal",
  tags: [],
  state: "ready",
  plan: "Keep the path.",
  pausedBy: null,
  resumesAt: null,
  autoMode: false,
  initiativePlanningThreadId: null,
  markedPlanned: false,
  hasPlanningThread: false,
  planConfirmed: true,
  filesToChange: [],
  estimatedTokens: null,
  definitionOfDone: ["Signing in returns the user to the page they asked for."],
  definitionOfDoneConfirmed: true,
  pipelineId: "full",
  proposedPipeline: null,
  blockedBy: [],
  originIdeaId: null,
  initiativeId: null,
  madeFor: null,
  projectMoves: [],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-07T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
};

function aProject(id: string, name: string, defaultPipeline = "full"): Project {
  return {
    id,
    name,
    path: `/projects/${id}`,
    baseBranch: "main",
    mark: { label: name.slice(0, 2).toUpperCase(), colour: "teal" },
    installCommand: "",
    commands: [
      { key: "build", name: "Build", kind: "build", commandLine: "" },
      { key: "lint", name: "Lint", kind: "lint", commandLine: "" },
      { key: "test", name: "Test", kind: "test", commandLine: "" },
    ],
    installInputs: [],
    publishingMode: "merge",
    defaultPipeline,
    icon: { light: null, dark: null },
    logo: { light: null, dark: null },
    repositoryUrl: null,
    environment: { set: [], unset: [], prependPath: [] },
    useProjectSkills: false,
    projectSkillsOff: [],
    projectDefault: null,
    useForEveryRole: false,
    roleOverrides: [],
    runEnvironment: "not-decided",
    projectLimit: 1,
    addedAt: "2026-11-01T10:00:00.000Z",
  };
}

const QUICK_FIX: OfficeWidePipeline = {
  id: "quick-fix",
  name: "Quick fix",
  description: "",
  stages: [],
  builtOnBy: [],
};

/** The window over a page of its own, its queries answered as given. */
function dialog(
  problems: readonly string[],
  projects: readonly Project[] = [
    aProject("admin-panel", "Admin panel"),
    aProject("shop", "Shop", "quick-fix"),
  ],
  task: Task = TASK,
): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(taskQueries.moveCheck(task.id).queryKey, { problems: [...problems] });
  queryClient.setQueryData(projectQueries.list().queryKey, [...projects]);
  queryClient.setQueryData(pipelineQueries.list().queryKey, [QUICK_FIX]);
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MoveTaskDialog task={task} onClose={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
}

/** By the words it starts with: a Button also holds its spinner's styles. */
function button(name: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((found) =>
    found.textContent.startsWith(name),
  );
}

describe("the Move window", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("offers the other Projects and says what the Move does", () => {
    dialog([]);

    // Each Project as its chip shows it: its mark's label, then its name.
    const choices = [...document.body.querySelectorAll('[role="radiogroup"] label')];
    expect(choices.map((choice) => choice.textContent)).toEqual(["SHShop"]);
    const text = document.body.textContent;
    expect(text).toContain("It has no Pipeline in Shop until one is chosen");
    expect(text).toContain("It goes back to Backlog, and out of the queue");
    expect(text).toContain("both Not confirmed");
    expect(text).toContain("Its Initiative, dependencies, Attachments and Threads stay with it.");
    expect(button("Move")).toBeDefined();
  });

  it("says a Task in Shaping or Backlog stays there", () => {
    dialog([], undefined, { ...TASK, state: "shaping" });
    expect(document.body.textContent).toContain("It stays in Shaping");
    document.body.replaceChildren();

    dialog([], undefined, { ...TASK, state: "backlog" });
    expect(document.body.textContent).toContain("It stays in Backlog.");
  });

  it("gives every reason while it is refused, with only Close", () => {
    const reasons = [
      "The Task has a worktree in its Project, so it can't move to another.",
      "A Task can't move to another Project once it has entered Planning: it was planned for this one.",
    ];

    dialog(reasons);

    const listed = [...document.body.querySelectorAll(".refusal-reasons li")];
    expect(listed.map((reason) => reason.textContent)).toEqual(reasons);
    expect(button("Move")).toBeUndefined();
    expect(button("Close")).toBeDefined();
  });

  it("says there is no other Project to move to", () => {
    dialog([], [aProject("admin-panel", "Admin panel")]);

    expect(document.body.textContent).toContain("There is no other Project to move it to.");
    expect(button("Move")).toBeUndefined();
  });

  it("moves the Task to the Project chosen", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...TASK, projectId: "shop", state: "backlog" })),
    );
    vi.stubGlobal("fetch", fetched);
    dialog([]);

    await act(async () => {
      button("Move")?.click();
      await new Promise((resolve) => setTimeout(resolve));
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/tasks/${TASK.id}/move`);
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe(JSON.stringify({ projectId: "shop" }));
  });
});

/** The labels the More menu offers once opened. */
function menuLabels(task: Task): string[] {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TaskMenu task={task} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  act(() => page.querySelector("button")?.click());
  return [...document.body.querySelectorAll(".floating-menu-label")].map(
    (item) => item.textContent,
  );
}

describe("the Task's More menu", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("offers Move until the Task has ended", () => {
    for (const state of ["shaping", "backlog", "ready", "in-progress"] as const) {
      expect(menuLabels({ ...TASK, state })).toContain("Move to another Project…");
      document.body.replaceChildren();
    }
    for (const state of ["done", "dropped"] as const) {
      expect(menuLabels({ ...TASK, state })).not.toContain("Move to another Project…");
      document.body.replaceChildren();
    }
  });
});
