import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  Initiative,
  OfficeWidePipeline,
  Project,
  ProjectPipeline,
  Stage,
  Task,
  TaskStage,
  TaskStages,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { branchQueries } from "../../api/branch-deletions.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries, projectPipelineQueries } from "../../api/pipelines.ts";
import { initiativeQueries } from "../../api/work.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { InitiativePipelineBlock } from "./initiative-pipeline-block.tsx";

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

const INITIATIVE: Initiative = {
  id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  name: "Usage exports",
  outcome: "Usage can be exported.",
  state: "shaping",
  originIdeaId: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  projectIds: ["admin-panel", "website"],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-12T09:00:00.000Z",
  endedAt: null,
  archivedAt: null,
  pausedAt: null,
  planningThreadId: null,
  planningAutoMode: false,
  pipelines: [],
  shortName: null,
  branches: [],
};

const TEST: Stage = { kind: "script", key: "test", name: "Test", optional: false, command: "test" };
const REVIEW: Stage = { kind: "gate", key: "review", name: "Review", optional: false };
const PUBLISH: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};

const REVIEWED: OfficeWidePipeline = {
  id: "reviewed",
  builtOnBy: [],
  name: "Reviewed release",
  description: "",
  stages: [TEST, REVIEW, PUBLISH],
};

const UNREVIEWED: OfficeWidePipeline = {
  id: "straight",
  builtOnBy: [],
  name: "Straight out",
  description: "",
  stages: [PUBLISH],
};

/** A Project Pipeline of Admin panel, which only Admin panel's block offers. */
const ADMINS_OWN = {
  ...REVIEWED,
  id: "admin-reviewed",
  projectId: "admin-panel",
  name: "Admin's reviewed",
  basePipeline: { id: REVIEWED.id, name: REVIEWED.name },
  stageChanges: [],
  rows: [],
  broken: [],
} as unknown as ProjectPipeline;

const PROJECTS = [
  {
    id: "admin-panel",
    name: "Admin panel",
    mark: { label: "AP", colour: "teal" },
    baseBranch: "main",
    defaultPipeline: "reviewed",
    publishingMode: "pull-request",
    commands: [],
  },
  {
    id: "website",
    name: "Website",
    mark: { label: "WE", colour: "amber" },
    baseBranch: "trunk",
    defaultPipeline: "",
    publishingMode: "merge",
    commands: [],
  },
] as unknown as Project[];

const BRANCH_IN_ADMIN = {
  projectId: "admin-panel",
  branch: "initiative/usage-exports",
  madeAt: "2026-11-12T10:00:00.000Z",
};

/** Active on Reviewed release in Admin panel, None in Website. */
const ACTIVE: Initiative = {
  ...INITIATIVE,
  state: "active",
  pipelines: [
    { projectId: "admin-panel", pipelineId: REVIEWED.id },
    { projectId: "website", pipelineId: null },
  ],
  shortName: "usage-exports",
  branches: [BRANCH_IN_ADMIN],
};

const PUBLISHING = {
  id: "publishing-1",
  title: "Usage exports → Admin panel",
  projectId: "admin-panel",
  initiativeId: INITIATIVE.id,
  madeFor: "publishing",
  resolvesTaskId: null,
  pipelineId: REVIEWED.id,
  state: "in-progress",
  blockedBy: [],
} as unknown as Task;

function aTaskStage(stage: Stage, state: TaskStage["state"]): TaskStage {
  return { stage, state, tokens: NO_TOKENS, wentBack: null, runs: [] };
}

function stagesOf(stages: readonly TaskStage[]): TaskStages {
  return {
    stages: [...stages],
    definitionOfDoneMet: [],
    definitionOfDoneOutOfReach: [],
    gatesCheckingDefinitionOfDone: [],
    editedForTask: false,
    lockedStages: 0,
    testResults: [],
  };
}

/** The card as the page shows it: from the Initiative's query, which a change's answer replaces. */
function Shown({
  initiativeId,
  tasks,
}: {
  readonly initiativeId: string;
  readonly tasks: readonly Task[];
}): ReactNode {
  const initiative = useQuery(initiativeQueries.one(initiativeId)).data;
  return (
    initiative && (
      <InitiativePipelineBlock initiative={initiative} tasks={tasks} projects={PROJECTS} />
    )
  );
}

async function rendered(
  initiative: Initiative,
  tasks: readonly Task[] = [],
  taskStages: Readonly<Record<string, TaskStages>> = {},
  branchesKnown = true,
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(branchQueries.ofInitiative(initiative.id).queryKey, {
    branches: initiative.branches.map(({ projectId, branch }) => ({
      projectId,
      branch,
      known: branchesKnown,
    })),
  });
  queryClient.setQueryData(pipelineQueries.list().queryKey, [REVIEWED, UNREVIEWED]);
  queryClient.setQueryData(projectPipelineQueries.every().queryKey, [ADMINS_OWN]);
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  for (const [taskId, stages] of Object.entries(taskStages)) {
    queryClient.setQueryData(pipelineQueries.taskStages(taskId).queryKey, stages);
  }
  queryClient.setQueryData(initiativeQueries.one(initiative.id).queryKey, initiative);
  // The Publishing Tasks link their pages.
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <Shown initiativeId={initiative.id} tasks={tasks} />,
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

function blockOf(page: HTMLElement, projectName: string): HTMLElement {
  const block = page.querySelector<HTMLElement>(`li[aria-label="${projectName}"]`);
  if (!block) throw new Error(`There is no block for ${projectName}.`);
  return block;
}

function buttonNamed(page: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find(({ textContent }) =>
    textContent.trim().startsWith(name),
  );
}

/** Edit in the block's head, there while shaping or active with a branch, and not editing. */
function editButton(page: HTMLElement): HTMLButtonElement | undefined {
  return buttonNamed(page, "Edit");
}

function stepTitles(page: HTMLElement): string[] {
  return [...page.querySelectorAll("form section")].map(
    (step) => step.getAttribute("aria-label") ?? "",
  );
}

function switchOf(page: HTMLElement, projectName: string): HTMLElement {
  const row = [
    ...page.querySelectorAll<HTMLElement>('[aria-label="Initiative\'s branch, per Project"] li'),
  ].find((candidate) => candidate.textContent.includes(projectName));
  const found = row?.querySelector<HTMLElement>('[role="switch"]');
  if (!found) throw new Error(`There is no switch for ${projectName}.`);
  return found;
}

function shortNameField(page: HTMLElement): HTMLInputElement {
  const field = page.querySelector<HTMLInputElement>('input[aria-label="Short name"]');
  if (!field) throw new Error("There is no Short name field.");
  return field;
}

function typeShortName(page: HTMLElement, text: string): void {
  const field = shortNameField(page);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pickerOf(page: HTMLElement, projectName: string): HTMLButtonElement {
  const picker = page.querySelector<HTMLButtonElement>(
    `[role="combobox"][aria-label="${projectName}'s Pipeline"]`,
  );
  if (!picker) throw new Error(`There is no Pipeline to choose for ${projectName}.`);
  return picker;
}

/** The picker's groups, each with its options' names, as it lists them open apart from the card. */
function groupsOffered(page: HTMLElement, projectName: string): string[][] {
  act(() => pickerOf(page, projectName).click());
  const groups = [...document.querySelectorAll('[role="listbox"] [role="group"]')].map((group) => [
    group.querySelector(".grouped-select-group")?.textContent ?? "",
    ...[...group.querySelectorAll(".grouped-select-label")].map(({ textContent }) => textContent),
  ]);
  act(() => pickerOf(page, projectName).click());
  return groups;
}

/** An option of the open list, which lies apart from the card. */
function optionNamed(name: string): HTMLElement {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.querySelector(".grouped-select-label")?.textContent === name,
  );
  if (!option) throw new Error(`There is no option ${name}.`);
  return option;
}

describe("the Initiative's Pipelines card", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    localStorage.clear();
  });

  it("while shaping with no branch, reads as words with Edit in its head and no control", async () => {
    const page = await rendered(INITIATIVE);

    expect(page.textContent).toContain("No Initiative's branch.");
    expect(page.textContent).toContain(
      "Press Edit to work on an Initiative's branch instead and publish the whole change at once, through a Pipeline.",
    );
    expect(page.querySelector('[role="combobox"]')).toBeNull();
    expect(page.querySelector('[role="switch"]')).toBeNull();
    expect(page.querySelector('[aria-label="Projects"]')).toBeNull();
    expect(editButton(page)).toBeDefined();
  });

  it("after Edit asks in order: the branch per Project, its name, then each Pipeline, dimmed until a Project is on", async () => {
    const page = await rendered(INITIATIVE);

    act(() => editButton(page)?.click());

    expect(editButton(page)).toBeUndefined();
    expect(stepTitles(page)).toEqual([
      "Work on an Initiative's branch?",
      "Branch name",
      "Pipeline",
    ]);
    expect(switchOf(page, "Admin panel").getAttribute("aria-checked")).toBe("false");
    expect(switchOf(page, "Website").getAttribute("aria-checked")).toBe("false");
    expect(page.textContent).toContain(
      "Only with an Initiative's branch: switch a Project on above.",
    );
    expect(page.querySelector("input")).toBeNull();
    expect(page.querySelector('[role="combobox"]')).toBeNull();
  });

  it("switching a Project on picks its Project default Pipeline and names the branch from the title; Save sends it all at once", async () => {
    const saved: Initiative = {
      ...INITIATIVE,
      pipelines: [{ projectId: "admin-panel", pipelineId: REVIEWED.id }],
      shortName: "usage-exports",
    };
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(saved)));
    vi.stubGlobal("fetch", fetched);
    const page = await rendered(INITIATIVE);
    act(() => editButton(page)?.click());

    act(() => switchOf(page, "Admin panel").click());

    expect(switchOf(page, "Admin panel").getAttribute("aria-checked")).toBe("true");
    expect(shortNameField(page).value).toBe("usage-exports");
    expect(page.textContent).toContain("Works on initiative/usage-exports, published into main");
    expect(pickerOf(page, "Admin panel").textContent).toBe("Reviewed release");
    expect(page.querySelector('[aria-label="Website\'s Pipeline"]')).toBeNull();
    await act(async () => {
      shortNameField(page).form?.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve));
    });

    const saves = fetched.mock.calls.filter(([, request]) => request?.method === "PUT");
    expect(saves).toHaveLength(1);
    const [url, request] = saves[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/pipelines`);
    expect(request?.method).toBe("PUT");
    expect(request?.body).toBe(
      JSON.stringify({
        pipelines: [
          { projectId: "admin-panel", pipelineId: REVIEWED.id },
          { projectId: "website", pipelineId: null },
        ],
        shortName: "usage-exports",
      }),
    );
    expect(page.querySelector("form")).toBeNull();
    expect(page.textContent).toContain("initiative/usage-exports");
    expect(blockOf(page, "Admin panel").textContent).toContain(
      "Reviewed release · 3 Stages, 1 Gate",
    );
  });

  it("offers each Project's choices as a Task's picker does, with no None", async () => {
    const page = await rendered(INITIATIVE);
    act(() => editButton(page)?.click());
    act(() => switchOf(page, "Admin panel").click());
    act(() => switchOf(page, "Website").click());

    expect(groupsOffered(page, "Admin panel")).toEqual([
      ["Admin panel's Pipelines", "Admin's reviewed"],
      ["Office-wide Pipelines", "Reviewed release", "Straight out"],
    ]);
    expect(groupsOffered(page, "Website")).toEqual([
      ["Office-wide Pipelines", "Reviewed release", "Straight out"],
    ]);
  });

  it("checks before it sends: a Project on with no Pipeline, and a branch name out of form", async () => {
    const fetched = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetched);
    const page = await rendered(INITIATIVE);
    act(() => editButton(page)?.click());
    act(() => switchOf(page, "Website").click());
    typeShortName(page, "Usage exports");

    expect(pickerOf(page, "Website").textContent).toBe("Choose a Pipeline");
    act(() => shortNameField(page).form?.requestSubmit());

    expect(fetched).not.toHaveBeenCalled();
    expect(page.textContent).toContain(
      "Choose a Pipeline: a Project on an Initiative's branch publishes through one.",
    );
    expect(page.textContent).toContain("Use only lower-case a–z, 0–9 and -");
    expect(shortNameField(page).getAttribute("aria-invalid")).toBe("true");

    act(() => pickerOf(page, "Website").click());
    act(() => optionNamed("Straight out").click());
    expect(pickerOf(page, "Website").textContent).toBe("Straight out");
    expect(page.textContent).not.toContain(
      "Choose a Pipeline: a Project on an Initiative's branch",
    );
    expect(page.textContent).toContain("Publishes without your review");

    typeShortName(page, "usage-exports");
    expect(page.textContent).not.toContain("Use only lower-case a–z, 0–9 and -");
    expect(shortNameField(page).getAttribute("aria-invalid")).toBe("false");
    expect(shortNameField(page).required).toBe(true);
  });

  it("Cancel throws the draft away", async () => {
    const fetched = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetched);
    const page = await rendered(INITIATIVE);
    act(() => editButton(page)?.click());
    act(() => switchOf(page, "Admin panel").click());

    act(() => buttonNamed(page, "Cancel")?.click());

    expect(fetched).not.toHaveBeenCalled();
    expect(page.querySelector("form")).toBeNull();
    expect(page.textContent).toContain("No Initiative's branch.");
    act(() => editButton(page)?.click());
    expect(switchOf(page, "Admin panel").getAttribute("aria-checked")).toBe("false");
  });

  it("switching every Project off saves None everywhere and no Short name", async () => {
    const withBranch: Initiative = {
      ...INITIATIVE,
      pipelines: [{ projectId: "admin-panel", pipelineId: REVIEWED.id }],
      shortName: "usage-exports",
    };
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(INITIATIVE)));
    vi.stubGlobal("fetch", fetched);
    const page = await rendered(withBranch);
    act(() => editButton(page)?.click());
    expect(shortNameField(page).value).toBe("usage-exports");

    act(() => switchOf(page, "Admin panel").click());
    await act(async () => {
      page.querySelector("form")?.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve));
    });

    const [, request] = fetched.mock.calls[0] ?? [];
    expect(request?.body).toBe(
      JSON.stringify({
        pipelines: [
          { projectId: "admin-panel", pipelineId: null },
          { projectId: "website", pipelineId: null },
        ],
        shortName: null,
      }),
    );
  });

  it("while shaping reads the branch and the Projects publishing Task by Task as facts", async () => {
    const page = await rendered({
      ...INITIATIVE,
      pipelines: [{ projectId: "admin-panel", pipelineId: REVIEWED.id }],
      shortName: "usage-exports",
    });

    const facts = page.querySelector("dl");
    expect(facts?.textContent).toContain(
      "Initiative's branchinitiative/usage-exportsmade at Confirmin Admin panel",
    );
    expect(facts?.textContent).toContain("Task by TaskWEWebsitepublishes each Task on its own");
    expect(blockOf(page, "Admin panel").textContent).toContain(
      "Reviewed release · 3 Stages, 1 Gate",
    );
    expect(page.querySelector('li[aria-label="Website"]')).toBeNull();
  });

  it("warns in that Project's block that a Pipeline without a Gate publishes without your review", async () => {
    const page = await rendered({
      ...INITIATIVE,
      pipelines: [
        { projectId: "admin-panel", pipelineId: REVIEWED.id },
        { projectId: "website", pipelineId: UNREVIEWED.id },
      ],
      shortName: "usage",
    });

    expect(blockOf(page, "Admin panel").textContent).not.toContain("Publishes without your review");
    expect(blockOf(page, "Website").textContent).toContain("Publishes without your review");
    expect(blockOf(page, "Website").textContent).toContain("published into trunk");
  });

  it("once confirmed shows the branch and each Project's Pipeline as facts, with Edit in its head", async () => {
    const page = await rendered(ACTIVE);

    expect(editButton(page)).toBeDefined();
    expect(page.querySelector('[role="combobox"]')).toBeNull();
    expect(page.querySelector("dl")?.textContent).toContain("initiative/usage-exports");
    expect(page.querySelector("dl")?.textContent).toContain("Task by TaskWEWebsite");
    const admin = blockOf(page, "Admin panel");
    expect(admin.textContent).toContain("Reviewed release · 3 Stages, 1 Gate");
    expect(admin.textContent).toContain("No Publishing Task yet");
    expect(
      admin.querySelector('[role="group"][aria-label="Reviewed release in Admin panel"]'),
    ).not.toBeNull();
    expect(page.querySelector('li[aria-label="Website"]')).toBeNull();
    expect(page.textContent).toContain(
      "A Project's Pipeline can still change, by Edit or a Proposal of whoever shapes Initiatives, until its Publishing Task starts.",
    );

    document.body.replaceChildren();
    const dropped = await rendered({
      ...ACTIVE,
      state: "dropped",
      endedAt: "2026-11-12T11:00:00.000Z",
    });
    expect(dropped.querySelector("dl")?.textContent).toContain("Delete branch…");
    expect(dropped.textContent).toContain("Dropped: no Publishing Task is added any more.");
    expect(editButton(dropped)).toBeUndefined();

    document.body.replaceChildren();
    const deleted = await rendered(
      { ...ACTIVE, state: "dropped", endedAt: "2026-11-12T11:00:00.000Z" },
      [],
      {},
      false,
    );
    expect(deleted.querySelector("dl")?.textContent).toContain("deleted");
    expect(deleted.querySelector("dl")?.textContent).not.toContain("Delete branch…");
    expect(deleted.textContent).toContain("Dropped · branches deleted");
  });

  it("once confirmed, Edit changes only the Pipeline of a Project on its branch; the switches and the branch name are fixed", async () => {
    const saved: Initiative = {
      ...ACTIVE,
      pipelines: [
        { projectId: "admin-panel", pipelineId: UNREVIEWED.id },
        { projectId: "website", pipelineId: null },
      ],
    };
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(saved)));
    vi.stubGlobal("fetch", fetched);
    const page = await rendered(ACTIVE);
    act(() => editButton(page)?.click());

    expect(page.textContent).toContain("Fixed at Confirm: go Back to Shaping to change them.");
    act(() => switchOf(page, "Admin panel").click());
    act(() => switchOf(page, "Website").click());
    expect(switchOf(page, "Admin panel").getAttribute("aria-checked")).toBe("true");
    expect(switchOf(page, "Website").getAttribute("aria-checked")).toBe("false");
    expect(shortNameField(page).disabled).toBe(true);
    expect(page.querySelector('[aria-label="Website\'s Pipeline"]')).toBeNull();
    expect(blockOf(page, "Website").textContent).toContain(
      "None: publishes Task by TaskFixed at Confirm: go Back to Shaping to change it.",
    );

    act(() => pickerOf(page, "Admin panel").click());
    act(() => optionNamed("Straight out").click());
    // The query cache tells the block of the saved Initiative on a later tick than the form closes.
    await act(async () => {
      page.querySelector("form")?.requestSubmit();
      await vi.waitFor(() =>
        expect(blockOf(page, "Admin panel").textContent).toContain(
          "Straight out · 1 Stage, no Gate",
        ),
      );
    });

    const saves = fetched.mock.calls.filter(([, request]) => request?.method === "PUT");
    expect(saves).toHaveLength(1);
    const [url, request] = saves[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/pipelines`);
    expect(request?.body).toBe(
      JSON.stringify({
        pipelines: [
          { projectId: "admin-panel", pipelineId: UNREVIEWED.id },
          { projectId: "website", pipelineId: null },
        ],
        shortName: "usage-exports",
      }),
    );
    expect(page.querySelector("form")).toBeNull();
  });

  it("once a Project's Publishing Task has started, its Pipeline shows read-only in the editor, with why", async () => {
    const page = await rendered(ACTIVE, [PUBLISHING]);
    act(() => editButton(page)?.click());

    expect(page.querySelector('[role="combobox"]')).toBeNull();
    expect(blockOf(page, "Admin panel").textContent).toContain(
      "Reviewed release · 3 Stages, 1 Gate",
    );
    expect(blockOf(page, "Admin panel").textContent).toContain(
      "Its Publishing Task has started, so its Pipeline can't change.",
    );

    document.body.replaceChildren();
    const ready = await rendered(ACTIVE, [{ ...PUBLISHING, state: "ready" } as Task]);
    act(() => editButton(ready)?.click());
    expect(pickerOf(ready, "Admin panel").textContent).toBe("Reviewed release");
  });

  it("once confirmed with no Initiative's branch, has no Edit", async () => {
    const page = await rendered({
      ...ACTIVE,
      pipelines: [
        { projectId: "admin-panel", pipelineId: null },
        { projectId: "website", pipelineId: null },
      ],
      shortName: null,
      branches: [],
    });

    expect(editButton(page)).toBeUndefined();
  });

  it("starts folded when confirmed with None in every Project, its line saying so", async () => {
    const page = await rendered({
      ...INITIATIVE,
      state: "active",
      pipelines: [
        { projectId: "admin-panel", pipelineId: null },
        { projectId: "website", pipelineId: null },
      ],
    });

    expect(page.textContent).toContain("None: publishes Task by Task");
    expect(page.querySelector('[aria-label="Projects"]')).toBeNull();
  });

  it("shows a Publishing Task in its Project's block, with its track and what it waits for", async () => {
    const fix = { id: "fix-1", title: "Fix the export", state: "ready" } as Task;
    const publishing = { ...PUBLISHING, blockedBy: [fix.id] } as Task;
    const page = await rendered(ACTIVE, [fix, publishing], {
      [publishing.id]: stagesOf([
        aTaskStage(TEST, "done"),
        aTaskStage(REVIEW, "waiting-on-you"),
        aTaskStage(PUBLISH, "pending"),
      ]),
    });

    const admin = blockOf(page, "Admin panel");
    expect(admin.querySelector("a")?.getAttribute("href")).toBe("/tasks/publishing-1");
    expect(admin.textContent).toContain("Usage exports → Admin panel");
    expect(admin.textContent).toContain("In progress");
    expect(admin.textContent).toContain("Waits for “Fix the export” before its next Stage.");
    const current = admin.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain("Review");
    expect(current?.textContent).toContain("Waiting on you");
    expect(page.textContent).toContain("Admin panel at Review, waiting on you");
    expect(page.textContent).toContain(
      "Their Publishing Tasks have started, so these Pipelines no longer change.",
    );
  });

  it("opens a Stage's history in the large window on the page", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    const page = await rendered(ACTIVE, [PUBLISHING], {
      [PUBLISHING.id]: stagesOf([aTaskStage(TEST, "running"), aTaskStage(REVIEW, "pending")]),
    });
    const test = blockOf(page, "Admin panel").querySelector<HTMLButtonElement>(
      `#publishing-${PUBLISHING.id}-test`,
    );

    act(() => test?.click());

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Test");
    expect(test?.closest("li")?.className).toContain("initiative-track-stage-selected");
  });
});
