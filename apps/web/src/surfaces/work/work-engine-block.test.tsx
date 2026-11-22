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
  RoleCardOptions,
  Task,
  TaskEngineCascade,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineSettingsQuery } from "../../api/engine.ts";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { InitiativeEngineBlock, TaskEngineBlock } from "./work-engine-block.tsx";
import { ENGINE_REFUSED, INITIATIVE_ENGINE_KEPT, TASK_ENGINE_KEPT } from "./work-engine-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPUS_ON_PERSONAL = { engineId: "personal", model: "claude-opus-5-5" };
const SONNET_ON_WORK = { engineId: "work", model: "claude-sonnet-5-5" };

const OPTIONS = {
  engines: [
    {
      engine: "work",
      models: ["claude-opus-5-5", "claude-sonnet-5-5"],
      defaultModel: "claude-sonnet-5-5",
      missingCapabilities: [],
    },
    {
      engine: "personal",
      models: ["claude-opus-5-5", "claude-sonnet-5-5"],
      defaultModel: "claude-opus-5-5",
      missingCapabilities: [],
    },
    {
      engine: "gemini",
      models: ["auto", "flash"],
      defaultModel: "auto",
      missingCapabilities: ["officeTools"],
    },
  ],
} as unknown as RoleCardOptions;

const SETTINGS = {
  engines: [
    { id: "work", name: "Work account" },
    { id: "personal", name: "Personal" },
    { id: "gemini", name: "Gemini" },
  ],
  officeDefault: SONNET_ON_WORK,
} as unknown as EngineSettings;

const PROJECT = {
  id: "the-office",
  name: "The Office",
  projectDefault: SONNET_ON_WORK,
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
  engine: null,
  initiativeEngine: null,
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
  roles: [
    {
      roleKey: "planner",
      roleName: "Pam",
      engine: { ...SONNET_ON_WORK, level: "project-default" },
    },
    {
      roleKey: "developer",
      roleName: "Dwight",
      engine: { ...OPUS_ON_PERSONAL, level: "role-override" },
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
  engine: null,
  branches: [],
};

function queryClientWithOptions(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleCardQueries.options().queryKey, OPTIONS);
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

function selectNamed(page: HTMLElement, label: string): HTMLSelectElement {
  const found = [...page.querySelectorAll("label")].find(
    ({ textContent }) => textContent.trim() === label,
  );
  const control = found && document.getElementById(found.htmlFor);
  if (!(control instanceof HTMLSelectElement)) throw new Error(`There is no field "${label}".`);
  return control;
}

async function pick(control: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
      control,
      value,
    );
    control.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
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

  it("starts folded, summing up the Project's engine it takes", async () => {
    const page = await taskPage(TASK);

    expect(page.querySelector(".record-fold-body")?.hasAttribute("hidden")).toBe(true);
    expect(summaryOf(page)).toBe("Project's engine · Sonnet 5.5 on Work account");
  });

  it("offers its Initiative's engine as the empty choice while its Initiative sets one", async () => {
    const page = await taskPage({ ...TASK, initiativeEngine: OPUS_ON_PERSONAL });

    const engine = selectNamed(page, "Engine");
    expect(engine.value).toBe("");
    expect(engine.options[0]?.textContent).toBe("Initiative's engine (Opus 5.5 on Personal)");
    expect(summaryOf(page)).toBe("Initiative's engine · Opus 5.5 on Personal");
  });

  it("lists what each Role runs on for it, and the level it comes from", async () => {
    const page = await taskPage(TASK);

    const rows = [...page.querySelectorAll('[aria-label="Runs on"] li')].map(
      ({ textContent }) => textContent,
    );
    expect(rows).toEqual([
      "PamSonnet 5.5 on Work accountfrom the Project default",
      "DwightOpus 5.5 on Personalfrom the Role override",
    ]);
  });

  it("saves a picked engine at once with its default model, and toasts it", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...TASK, engine: OPUS_ON_PERSONAL })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = await taskPage(TASK);

    await pick(selectNamed(page, "Engine"), "personal");

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/tasks/${TASK.id}/engine`);
    expect(request?.method).toBe("PUT");
    expect(JSON.parse(String(request?.body))).toEqual({ engine: OPUS_ON_PERSONAL });
    expect(summaryOf(page)).toBe("Opus 5.5 on Personal · set for this Task");
    expect(document.body.textContent).toContain(
      "Engine saved for Export Stats as CSV: its next sessions start fresh, on Opus 5.5 on Personal.",
    );
  });

  it("shows the service's refusal under the fields and keeps what is saved", async () => {
    const refusal =
      "On “Export Stats as CSV”, the Developer would run on Gemini, which can't use Office tools, as their Pipelines' Agent Stages need.";
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json({ statusCode: 422, message: refusal, reasons: [refusal] }, { status: 422 }),
      ),
    );
    const page = await taskPage(TASK);

    await pick(selectNamed(page, "Engine"), "gemini");

    expect(page.textContent).toContain(ENGINE_REFUSED);
    expect(page.textContent).toContain(refusal);
    expect(selectNamed(page, "Engine").value).toBe("");
  });

  it("is read-only once the Task is Done", async () => {
    const page = await taskPage({ ...TASK, state: "done", engine: OPUS_ON_PERSONAL });

    expect(page.querySelector("select")).toBeNull();
    expect(page.querySelector(".work-engine-kept")?.textContent).toBe(
      "EnginePersonalModelOpus 5.5",
    );
    expect(page.textContent).toContain(TASK_ENGINE_KEPT);
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
    engine: SONNET_ON_WORK,
  } satisfies Task;
  const FINISHED = {
    ...TASK,
    id: "00000000-0000-4000-8000-000000000043",
    title: "Old dashboard cleanup",
    state: "done",
  } satisfies Task;

  it("lists its open Tasks with the level each takes, leaving out finished ones", async () => {
    const page = await initiativePage({ ...INITIATIVE, engine: OPUS_ON_PERSONAL }, [
      TASK,
      OWN,
      FINISHED,
    ]);

    const rows = [...page.querySelectorAll('[aria-label="Its Tasks"] li')];
    expect(rows.map((row) => row.querySelector("a")?.textContent)).toEqual([
      "Export Stats as CSV",
      "Usage report page",
    ]);
    expect(rows[0]?.querySelector(".work-engine-row-what")?.textContent).toBe(
      "Opus 5.5 on Personalthe Initiative's engine",
    );
    expect(rows[1]?.querySelector(".work-engine-row-what")?.textContent).toBe(
      "Sonnet 5.5 on Work accountits own engine",
    );
  });

  it("saves a picked engine and toasts how many of its open Tasks take it", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...INITIATIVE, engine: OPUS_ON_PERSONAL })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = await initiativePage(INITIATIVE, [TASK, OWN, FINISHED]);

    await pick(selectNamed(page, "Engine"), "personal");

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/engine`);
    expect(JSON.parse(String(request?.body))).toEqual({ engine: OPUS_ON_PERSONAL });
    expect(document.body.textContent).toContain(
      "Engine saved for Usage reports: its Threads and its 1 open Task that sets none runs on Opus 5.5 on Personal from their next session.",
    );
  });

  it("is read-only once Done", async () => {
    const page = await initiativePage({ ...INITIATIVE, state: "done" }, [FINISHED]);

    expect(page.querySelector("select")).toBeNull();
    expect(page.querySelector(".work-engine-kept")?.textContent).toBe("EngineProject's engine");
    expect(page.textContent).toContain(INITIATIVE_ENGINE_KEPT);
  });
});
