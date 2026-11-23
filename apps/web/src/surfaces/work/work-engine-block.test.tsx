import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  EngineSettings,
  Initiative,
  Project,
  Task,
  TaskEngineCascade,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineSettingsQuery } from "../../api/engine.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { InitiativeEngineBlock, TaskEngineBlock } from "./work-engine-block.tsx";
import {
  ENGINE_REFUSED,
  INITIATIVE_ENGINE_KEPT,
  INITIATIVE_OFF_HINT,
  TASK_ENGINE_KEPT,
  TASK_FOLLOWS_INITIATIVE_HINT,
} from "./work-engine-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the Engine select's list never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const SETTINGS = {
  engines: [
    { id: "work", name: "Work account", kind: "claude-code", defaultModel: "claude-sonnet-5-5" },
    { id: "personal", name: "Personal", kind: "claude-code", defaultModel: "claude-opus-5-5" },
    { id: "gemini", name: "Gemini", kind: "gemini-cli", defaultModel: "auto" },
  ],
  officeDefault: { engineType: "claude-code", engineId: "work" },
} as unknown as EngineSettings;

const PROJECT = {
  id: "the-office",
  name: "The Office",
  engine: {
    default: { engineType: "claude-code", engineId: "work" },
    force: null,
    people: [],
    standIns: { useOwnList: false, engineIds: [] },
  },
} as unknown as Project;

const TASK: Task = {
  id: "00000000-0000-4000-8000-000000000041",
  title: "Export Stats as CSV",
  description: "A CSV of the Stats page's tokens and cost.",
  projectId: PROJECT.id,
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
  commitMessage: "Export Stats as CSV",
  commitMessageWritten: false,
  commitMessagePublishedAt: null,
  pipelineId: "full",
  proposedPipeline: null,
  blockedBy: [],
  originIdeaId: null,
  engineOverride: null,
  initiativeEngineOverride: null,
  initiativeId: null,
  madeFor: null,
  resolvesTaskId: null,
  projectMoves: [],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-20T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
  pullRequestEnd: null,
  kind: "feature",
  causedBy: null,
  foundInVersion: null,
  foundWhileWorkingOn: null,
  dropReason: null,
};

const CASCADE: TaskEngineCascade = {
  engine: {
    engineId: "work",
    engineType: "claude-code",
    engineName: "Work account",
    level: "project",
  },
  standIns: { from: "office", engineIds: [] },
  people: [
    {
      roleKey: "planner",
      roleName: "Pam",
      work: {
        model: "claude-sonnet-5-5",
        effort: "high",
        modelLevel: "engine",
        effortLevel: "person",
      },
      stages: [],
    },
    {
      roleKey: "developer",
      roleName: "Dwight",
      work: {
        model: "claude-opus-5-5",
        effort: "medium",
        modelLevel: "person",
        effortLevel: "person",
      },
      stages: [{ stageName: "Implement", effort: "max" }],
    },
  ],
};

const INITIATIVE: Initiative = {
  id: "00000000-0000-4000-8000-000000000051",
  name: "Usage reports",
  outcome: "",
  state: "active",
  originIdeaId: null,
  projectIds: [PROJECT.id],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-10T09:00:00.000Z",
  endedAt: null,
  archivedAt: null,
  pausedAt: null,
  planningThreadId: null,
  planningAutoMode: false,
  pipelines: [],
  shortName: null,
  engineOverride: null,
  branches: [],
};

function queryClientWithOptions(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(engineSettingsQuery().queryKey, SETTINGS);
  queryClient.setQueryData(projectQueries.one(PROJECT.id).queryKey, PROJECT);
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  return queryClient;
}

/** The block as the page shows it: from the Task's query, which a save's answer replaces. */
function ShownTask({ taskId }: { readonly taskId: string }): ReactNode {
  const task = useQuery(taskQueries.one(taskId)).data;
  return task && <TaskEngineBlock task={task} />;
}

function ShownInitiative({
  initiativeId,
  tasks,
}: {
  readonly initiativeId: string;
  readonly tasks: readonly Task[];
}): ReactNode {
  const initiative = useQuery(initiativeQueries.one(initiativeId)).data;
  return (
    initiative && (
      <InitiativeEngineBlock initiative={initiative} tasks={tasks} projects={[PROJECT]} />
    )
  );
}

async function rendered(queryClient: QueryClient, shown: () => ReactNode): Promise<HTMLElement> {
  const router = createRouter({
    routeTree: createRootRoute({ component: shown }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
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

async function taskPage(task: Task): Promise<HTMLElement> {
  const queryClient = queryClientWithOptions();
  queryClient.setQueryData(taskQueries.one(task.id).queryKey, task);
  queryClient.setQueryData(taskQueries.engineCascade(task.id).queryKey, CASCADE);
  return rendered(queryClient, () => <ShownTask taskId={task.id} />);
}

async function initiativePage(
  initiative: Initiative,
  tasks: readonly Task[],
): Promise<HTMLElement> {
  const queryClient = queryClientWithOptions();
  queryClient.setQueryData(initiativeQueries.one(initiative.id).queryKey, initiative);
  return rendered(queryClient, () => (
    <ShownInitiative initiativeId={initiative.id} tasks={tasks} />
  ));
}

function overrideSwitch(page: HTMLElement): HTMLElement {
  const found = page.querySelector<HTMLElement>('[role="switch"]');
  if (!found) throw new Error("There is no switch.");
  return found;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
  });
}

function engineField(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>('[role="combobox"]');
}

/** Opens the Engine select and picks the engine named. */
async function pickEngine(page: HTMLElement, name: string): Promise<void> {
  const field = engineField(page);
  if (!field) throw new Error("There is no Engine field.");
  await click(field);
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (row) => row.querySelector(".grouped-select-label")?.textContent === name,
  );
  if (!option) throw new Error(`There is no option "${name}".`);
  await click(option);
  // The save's answer lands a few ticks later.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function summaryOf(page: HTMLElement): string {
  return page.querySelector(".record-fold-summary")?.textContent ?? "";
}

describe("the Task's Engine fold", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    localStorage.clear();
  });

  it("starts folded, its switch off, naming the Project's engine it follows", async () => {
    const page = await taskPage(TASK);

    expect(page.querySelector(".record-fold-body")?.hasAttribute("hidden")).toBe(true);
    expect(summaryOf(page)).toBe("Work account · from the Project");
    expect(overrideSwitch(page).getAttribute("aria-checked")).toBe("false");
    expect(engineField(page)).toBeNull();
    expect(page.textContent).toContain(
      "Runs on Work account, from the Project, with the Office's Stand-in Engines.",
    );
  });

  it("names its Initiative's override while it follows one", async () => {
    const page = await taskPage({ ...TASK, initiativeEngineOverride: "personal" });

    expect(summaryOf(page)).toBe("Personal · from its Initiative · no stand-ins");
    expect(page.textContent).toContain(TASK_FOLLOWS_INITIATIVE_HINT);
    expect(page.textContent).toContain("Runs on Personal, from its Initiative, with no stand-ins.");
  });

  it("shows its override in the Engine select, grouped by engine type, with the no stand-ins note", async () => {
    const page = await taskPage({ ...TASK, engineOverride: "gemini" });

    expect(summaryOf(page)).toBe("Gemini · set for this Task · no stand-ins");
    expect(overrideSwitch(page).getAttribute("aria-checked")).toBe("true");
    expect(engineField(page)?.textContent).toBe("Gemini");
    expect(page.textContent).toContain(
      "No stand-ins: when Gemini's usage window is used up, the Task waits for the reset.",
    );
    await click(engineField(page) as HTMLElement);
    const groups = [...document.querySelectorAll('[role="listbox"] [role="group"]')].map(
      (group) => [
        group.querySelector(".grouped-select-group")?.textContent,
        [...group.querySelectorAll(".grouped-select-label")].map(({ textContent }) => textContent),
      ],
    );
    expect(groups).toEqual([
      ["Claude Code", ["Work account", "Personal"]],
      ["Gemini CLI", ["Gemini"]],
    ]);
  });

  it("lists the model and effort each person works with, where each comes from, and a Stage's own effort", async () => {
    const page = await taskPage(TASK);

    const rows = [...page.querySelectorAll('[aria-label="Runs on"] li')].map(
      ({ textContent }) => textContent,
    );
    expect(rows).toEqual([
      "PamSonnet 5.5 · effort highmodel: the engine's default; effort: from Pam's Role card",
      "DwightOpus 5.5 · effort mediumfrom Dwight's Role cardMax on Implement",
    ]);
  });

  it("turned on, saves the engine it followed at once, an engine only, and toasts it", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...TASK, engineOverride: "work" })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = await taskPage(TASK);

    await click(overrideSwitch(page));

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/tasks/${TASK.id}/engine`);
    expect(request?.method).toBe("PUT");
    expect(JSON.parse(String(request?.body))).toEqual({ engineId: "work" });
    expect(summaryOf(page)).toBe("Work account · set for this Task · no stand-ins");
    expect(document.body.textContent).toContain(
      "Export Stats as CSV runs on Work account, with no stand-ins.",
    );
  });

  it("saves a picked engine, and turned off follows its Project's engine again", async () => {
    const sent: unknown[] = [];
    const fetched = vi.fn<typeof fetch>((_url, request) => {
      if (request?.method !== "PUT") return Promise.resolve(Response.json([]));
      const { engineId } = JSON.parse(String(request.body)) as { engineId: string | null };
      sent.push({ engineId });
      return Promise.resolve(Response.json({ ...TASK, engineOverride: engineId }));
    });
    vi.stubGlobal("fetch", fetched);
    const page = await taskPage({ ...TASK, engineOverride: "work" });

    await pickEngine(page, "Personal");
    expect(sent).toEqual([{ engineId: "personal" }]);
    expect(summaryOf(page)).toBe("Personal · set for this Task · no stand-ins");

    await click(overrideSwitch(page));
    expect(sent).toEqual([{ engineId: "personal" }, { engineId: null }]);
    expect(document.body.textContent).toContain(
      "Export Stats as CSV follows its Project's engine again.",
    );
    expect(summaryOf(page)).toBe("Work account · from the Project");
  });

  it("shows the service's refusal under the field and keeps what is saved", async () => {
    const refusal =
      "On “Export Stats as CSV”, the Developer would run on Gemini, which can't use Office tools, as their Pipelines' Agent Stages need.";
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json({ statusCode: 422, message: refusal, reasons: [refusal] }, { status: 422 }),
      ),
    );
    const page = await taskPage({ ...TASK, engineOverride: "work" });

    await pickEngine(page, "Gemini");

    expect(page.textContent).toContain(ENGINE_REFUSED);
    expect(page.textContent).toContain(refusal);
    expect(engineField(page)?.textContent).toBe("Work account");
  });

  it("says a running Stage's session finishes on its engine", async () => {
    const page = await taskPage({ ...TASK, state: "in-progress" });

    expect(page.textContent).toContain("That session finishes on the engine it started on");
  });

  it.each(["done", "dropped"] as const)("is read-only once the Task is %s", async (state) => {
    const page = await taskPage({ ...TASK, state, engineOverride: "personal" });

    expect(page.querySelector('[role="switch"]')).toBeNull();
    expect(engineField(page)).toBeNull();
    expect(page.querySelector(".work-engine-kept")?.textContent).toBe(
      "Override the enginePersonal",
    );
    expect(page.textContent).toContain(TASK_ENGINE_KEPT);
    expect(page.textContent).not.toContain("Opus");
  });
});

describe("the Initiative's Engine fold", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    localStorage.clear();
  });

  const OWN = {
    ...TASK,
    id: "00000000-0000-4000-8000-000000000042",
    title: "Usage report page",
    state: "in-progress",
    engineOverride: "work",
  } satisfies Task;
  const FINISHED = {
    ...TASK,
    id: "00000000-0000-4000-8000-000000000043",
    title: "Old dashboard cleanup",
    state: "done",
  } satisfies Task;

  it("off, hints that its Threads and Tasks run on their Project's engine", async () => {
    const page = await initiativePage(INITIATIVE, [TASK]);

    expect(summaryOf(page)).toBe("Work account · from the Project");
    expect(overrideSwitch(page).getAttribute("aria-checked")).toBe("false");
    expect(page.textContent).toContain(INITIATIVE_OFF_HINT);
  });

  it("lists its open Tasks, which follow its override and which have their own", async () => {
    const page = await initiativePage({ ...INITIATIVE, engineOverride: "personal" }, [
      TASK,
      OWN,
      FINISHED,
    ]);

    expect(summaryOf(page)).toBe("Personal · set for this Initiative · no stand-ins");
    expect(page.textContent).toContain(
      "No stand-ins: when Personal's usage window is used up, its Tasks wait for the reset.",
    );
    const rows = [...page.querySelectorAll('[aria-label="Its Tasks"] li')];
    expect(rows.map((row) => row.querySelector("a")?.textContent)).toEqual([
      "Export Stats as CSV",
      "Usage report page",
    ]);
    expect(rows[0]?.querySelector(".work-engine-row-what")?.textContent).toBe(
      "Personalfollows the Initiative's override",
    );
    expect(rows[1]?.querySelector(".work-engine-row-what")?.textContent).toBe(
      "Work accountits own override",
    );
  });

  it("turned on, saves its first Project's engine and toasts it", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...INITIATIVE, engineOverride: "work" })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = await initiativePage(INITIATIVE, [TASK, OWN, FINISHED]);

    await click(overrideSwitch(page));

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/engine`);
    expect(JSON.parse(String(request?.body))).toEqual({ engineId: "work" });
    expect(document.body.textContent).toContain(
      "Usage reports runs on Work account, with no stand-ins.",
    );
  });

  it.each(["done", "dropped"] as const)("is read-only once %s", async (state) => {
    const page = await initiativePage({ ...INITIATIVE, state }, [FINISHED]);

    expect(page.querySelector('[role="switch"]')).toBeNull();
    expect(page.querySelector(".work-engine-kept")?.textContent).toBe("Override the engineOff");
    expect(page.textContent).toContain(INITIATIVE_ENGINE_KEPT);
  });
});
