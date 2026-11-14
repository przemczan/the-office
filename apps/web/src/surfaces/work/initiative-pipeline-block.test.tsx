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
  createdBy: { kind: "user" },
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
    defaultPipeline: "",
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
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
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

  it("starts on None in each Project while shaping and says Confirm fixes it", async () => {
    const page = await rendered(INITIATIVE);

    expect(page.textContent).toContain(
      "Each Project publishes through a Pipeline of its own, or None. Whether a Project has one is fixed at Confirm.",
    );
    expect(pickerOf(page, "Admin panel").textContent).toBe("None");
    expect(pickerOf(page, "Website").textContent).toBe("None");
    expect(blockOf(page, "Website").textContent).toContain(
      "None: its Tasks publish on their own, each as it is done.",
    );
    expect(page.textContent).not.toContain("Short name");
  });

  it("groups each Project's choices as a Task's picker does, with its own Project Pipelines only", async () => {
    const page = await rendered(INITIATIVE);

    expect(groupsOffered(page, "Admin panel")).toEqual([
      ["No Pipeline", "None"],
      ["Admin panel's Pipelines", "Admin's reviewed"],
      ["Office-wide Pipelines", "Reviewed release", "Straight out"],
    ]);
    expect(groupsOffered(page, "Website")).toEqual([
      ["No Pipeline", "None"],
      ["Office-wide Pipelines", "Reviewed release", "Straight out"],
    ]);
  });

  it("sends the Pipeline chosen for one Project and shows it at once", async () => {
    const chosen: Initiative = {
      ...INITIATIVE,
      pipelines: [{ projectId: "admin-panel", pipelineId: ADMINS_OWN.id }],
      shortName: "usage-exports",
    };
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(chosen)));
    vi.stubGlobal("fetch", fetched);
    const page = await rendered(INITIATIVE);

    act(() => pickerOf(page, "Admin panel").click());
    await act(async () => {
      optionNamed("Admin's reviewed").click();
      await new Promise((resolve) => setTimeout(resolve));
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/pipeline`);
    expect(request?.method).toBe("PUT");
    expect(request?.body).toBe(
      JSON.stringify({ projectId: "admin-panel", pipelineId: ADMINS_OWN.id }),
    );
    expect(pickerOf(page, "Admin panel").textContent).toBe("Admin's reviewed");
    expect(blockOf(page, "Admin panel").textContent).toContain("3 Stages, 1 Gate");
    expect(pickerOf(page, "Website").textContent).toBe("None");
  });

  it("shows the Short name once a Project has a Pipeline, and saves an edited one", async () => {
    const withPipeline: Initiative = {
      ...INITIATIVE,
      pipelines: [{ projectId: "admin-panel", pipelineId: REVIEWED.id }],
      shortName: "usage-exports",
    };
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...withPipeline, shortName: "exports" })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = await rendered(withPipeline);
    expect(page.textContent).toContain("usage-exports");
    expect(blockOf(page, "Admin panel").textContent).toContain(
      "initiative/usage-exports· made at Confirm",
    );
    expect(blockOf(page, "Website").textContent).not.toContain("initiative/usage-exports");

    const edit = [...page.querySelectorAll("button")].find(({ textContent }) =>
      textContent.startsWith("Edit"),
    );
    act(() => edit?.click());
    const field = page.querySelector<HTMLInputElement>('input[maxlength="40"]');
    if (!field) throw new Error("There is no Short name field.");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        field,
        "exports",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(page.textContent).toContain("initiative/exports");
    await act(async () => {
      field.form?.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve));
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/short-name`);
    expect(request?.body).toBe(JSON.stringify({ shortName: "exports" }));
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

  it("once confirmed shows each Project's Pipeline or None, and its branch, read-only", async () => {
    const page = await rendered(ACTIVE);

    expect(page.querySelector('[role="combobox"]')).toBeNull();
    const admin = blockOf(page, "Admin panel");
    expect(admin.textContent).toContain("Reviewed release · 3 Stages, 1 Gate");
    expect(admin.textContent).toContain("No Publishing Task yet");
    expect(admin.textContent).toContain("initiative/usage-exports");
    expect(
      admin.querySelector('[role="group"][aria-label="Reviewed release in Admin panel"]'),
    ).not.toBeNull();
    const website = blockOf(page, "Website");
    expect(website.textContent).toContain("None · publishes Task by Task");
    expect(website.textContent).not.toContain("initiative/usage-exports");
    expect(page.textContent).toContain(
      "Another Pipeline for a Project comes by the CTO's Proposal.",
    );

    document.body.replaceChildren();
    const dropped = await rendered({
      ...ACTIVE,
      state: "dropped",
      endedAt: "2026-11-12T11:00:00.000Z",
    });
    expect(dropped.textContent).toContain("kept for you to delete");
    expect(dropped.textContent).toContain("Dropped: no Publishing Task is added any more.");
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
