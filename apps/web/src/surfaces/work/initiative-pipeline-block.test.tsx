import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Initiative, OfficeWidePipeline, Project, Task } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineQueries, projectPipelineQueries } from "../../api/pipelines.ts";
import { initiativeQueries } from "../../api/work.ts";
import { InitiativePipelineBlock } from "./initiative-pipeline-block.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE: Initiative = {
  id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  name: "Usage exports",
  outcome: "Usage can be exported.",
  state: "shaping",
  originIdeaId: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  projectIds: ["admin-panel"],
  createdBy: { kind: "user" },
  createdAt: "2026-11-12T09:00:00.000Z",
  endedAt: null,
  archivedAt: null,
  planningThreadId: null,
  planningAutoMode: false,
  pipelineId: null,
  shortName: null,
  branches: [],
};

const REVIEWED: OfficeWidePipeline = {
  id: "reviewed",
  builtOnBy: [],
  name: "Reviewed release",
  description: "",
  stages: [
    { kind: "script", key: "test", name: "Test", optional: false, command: "test" },
    { kind: "gate", key: "review", name: "Review", optional: false },
    { kind: "script", key: "publish", name: "Publish", optional: false, command: "publish" },
  ],
};

const UNREVIEWED: OfficeWidePipeline = {
  id: "straight",
  builtOnBy: [],
  name: "Straight out",
  description: "",
  stages: [
    { kind: "script", key: "publish", name: "Publish", optional: false, command: "publish" },
  ],
};

const PROJECTS = [
  { id: "admin-panel", name: "Admin panel", mark: { label: "AP", colour: "teal" } },
] as unknown as Project[];

/** The block as the page shows it: from the Initiative's query, which a change's answer replaces. */
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

async function rendered(initiative: Initiative, tasks: readonly Task[] = []): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(pipelineQueries.list().queryKey, [REVIEWED, UNREVIEWED]);
  // A Project Pipeline of a Project it spans, which an Initiative's Pipeline can never be.
  queryClient.setQueryData(projectPipelineQueries.every().queryKey, [
    {
      ...REVIEWED,
      id: "admin-reviewed",
      projectId: "admin-panel",
      name: "Admin's reviewed",
      basePipeline: { id: REVIEWED.id, name: REVIEWED.name },
      stageChanges: [],
      rows: [],
      broken: [],
    },
  ]);
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

function pipelineSelect(page: HTMLElement): HTMLSelectElement {
  const select = page.querySelector("select");
  if (!select) throw new Error("There is no Pipeline to choose.");
  return select;
}

function choose(select: HTMLSelectElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setValue?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("the Initiative's Pipeline block", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    localStorage.clear();
  });

  it("starts on None while shaping and says Confirm fixes it", async () => {
    const page = await rendered(INITIATIVE);
    const select = pipelineSelect(page);
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]?.textContent).toBe("None");
    expect([...select.options].map(({ textContent }) => textContent)).toEqual([
      "None",
      "Reviewed release",
      "Straight out",
    ]);
    expect(page.textContent).toContain("Whether it has a Pipeline is fixed at Confirm.");
  });

  it("offers office-wide Pipelines only, never a Project Pipeline of a Project it spans", async () => {
    const page = await rendered(INITIATIVE);

    const offered = [...pipelineSelect(page).options].map(({ textContent }) => textContent);
    expect(offered).not.toContain("Admin's reviewed");
  });

  it("sends the chosen Pipeline and shows it at once", async () => {
    const chosen = { ...INITIATIVE, pipelineId: REVIEWED.id, shortName: "usage-exports" };
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(chosen)));
    vi.stubGlobal("fetch", fetched);
    const page = await rendered(INITIATIVE);

    await act(async () => {
      choose(pipelineSelect(page), REVIEWED.id);
      await new Promise((resolve) => setTimeout(resolve));
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/pipeline`);
    expect(request?.method).toBe("PUT");
    expect(request?.body).toBe(JSON.stringify({ pipelineId: REVIEWED.id }));
    expect(pipelineSelect(page).value).toBe(REVIEWED.id);
  });

  it("shows the Short name and its branch, and saves an edited one", async () => {
    const withPipeline = { ...INITIATIVE, pipelineId: REVIEWED.id, shortName: "usage-exports" };
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...withPipeline, shortName: "exports" })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = await rendered(withPipeline);
    expect(page.textContent).toContain("usage-exports");
    expect(page.textContent).toContain("initiative/usage-exports");
    expect(page.textContent).not.toContain("Publishes without your review");

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

  it("warns that a Pipeline without a Gate publishes without your review", async () => {
    const page = await rendered({ ...INITIATIVE, pipelineId: UNREVIEWED.id, shortName: "usage" });
    expect(page.textContent).toContain("Publishes without your review");
  });

  it("once confirmed shows the Pipeline and each Initiative's branch, read-only", async () => {
    const active: Initiative = {
      ...INITIATIVE,
      state: "active",
      pipelineId: REVIEWED.id,
      shortName: "usage-exports",
      branches: [
        {
          projectId: "admin-panel",
          branch: "initiative/usage-exports",
          madeAt: "2026-11-12T10:00:00.000Z",
        },
      ],
    };
    const page = await rendered(active);
    expect(page.querySelector("select")).toBeNull();
    expect(page.textContent).toContain("Reviewed release");
    expect(page.textContent).toContain("Admin panel");
    expect(page.textContent).toContain("initiative/usage-exports");
    expect(page.textContent).toContain("CTO's Proposal");
    expect(page.textContent).not.toContain("kept for you to delete");

    document.body.replaceChildren();
    const dropped = await rendered({
      ...active,
      state: "dropped",
      endedAt: "2026-11-12T11:00:00.000Z",
    });
    expect(dropped.textContent).toContain("kept for you to delete");
    expect(dropped.textContent).not.toContain("CTO's Proposal");
  });

  it("once confirmed with None says it publishes Task by Task", async () => {
    const page = await rendered({ ...INITIATIVE, state: "active" });
    expect(page.textContent).toContain("None: publishes Task by Task");
  });

  it("lists the Publishing Tasks with their Project and state, and what a started one waits for", async () => {
    const active: Initiative = {
      ...INITIATIVE,
      state: "active",
      pipelineId: REVIEWED.id,
      shortName: "usage-exports",
      branches: [
        {
          projectId: "admin-panel",
          branch: "initiative/usage-exports",
          madeAt: "2026-11-12T10:00:00.000Z",
        },
      ],
    };
    const fix = { id: "fix-1", title: "Fix the export", state: "ready" } as Task;
    const publishing = {
      id: "publishing-1",
      title: "Usage exports → Admin panel",
      projectId: "admin-panel",
      initiativeId: INITIATIVE.id,
      madeFor: "publishing",
      state: "in-progress",
      blockedBy: [fix.id],
    } as Task;

    const page = await rendered(active, [fix, publishing]);

    const list = page.querySelector('[aria-label="Publishing Tasks"]');
    expect(list?.textContent).toContain("Usage exports → Admin panel");
    expect(list?.textContent).toContain("In progress");
    expect(list?.textContent).toContain("AP");
    expect(list?.querySelector("a")?.getAttribute("href")).toBe("/tasks/publishing-1");
    expect(list?.textContent).toContain("Waits for “Fix the export” before its next Stage.");
  });

  it("says when The Office adds the Publishing Tasks, while there are none yet", async () => {
    const page = await rendered({ ...INITIATIVE, state: "active", pipelineId: REVIEWED.id });
    expect(page.textContent).toContain("The Office adds a Publishing Task in each Project");
  });
});
