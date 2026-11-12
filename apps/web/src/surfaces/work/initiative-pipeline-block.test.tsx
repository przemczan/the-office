import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { Initiative, Pipeline, Project } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineQueries } from "../../api/pipelines.ts";
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

const REVIEWED: Pipeline = {
  id: "reviewed",
  name: "Reviewed release",
  description: "",
  stages: [
    { kind: "script", key: "test", name: "Test", optional: false, command: "test" },
    { kind: "gate", key: "review", name: "Review", optional: false },
    { kind: "script", key: "publish", name: "Publish", optional: false, command: "publish" },
  ],
};

const UNREVIEWED: Pipeline = {
  id: "straight",
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
function Shown({ initiativeId }: { readonly initiativeId: string }): ReactNode {
  const initiative = useQuery(initiativeQueries.one(initiativeId)).data;
  return initiative && <InitiativePipelineBlock initiative={initiative} projects={PROJECTS} />;
}

function rendered(initiative: Initiative): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(pipelineQueries.list().queryKey, [REVIEWED, UNREVIEWED]);
  queryClient.setQueryData(initiativeQueries.one(initiative.id).queryKey, initiative);
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <Shown initiativeId={initiative.id} />
      </QueryClientProvider>,
    ),
  );
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

  it("starts on None while shaping and says Confirm fixes it", () => {
    const page = rendered(INITIATIVE);
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

  it("sends the chosen Pipeline and shows it at once", async () => {
    const chosen = { ...INITIATIVE, pipelineId: REVIEWED.id, shortName: "usage-exports" };
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(chosen)));
    vi.stubGlobal("fetch", fetched);
    const page = rendered(INITIATIVE);

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
    const page = rendered(withPipeline);
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

  it("warns that a Pipeline without a Gate publishes without your review", () => {
    const page = rendered({ ...INITIATIVE, pipelineId: UNREVIEWED.id, shortName: "usage" });
    expect(page.textContent).toContain("Publishes without your review");
  });

  it("once confirmed shows the Pipeline and each Initiative's branch, read-only", () => {
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
    const page = rendered(active);
    expect(page.querySelector("select")).toBeNull();
    expect(page.textContent).toContain("Reviewed release");
    expect(page.textContent).toContain("Admin panel");
    expect(page.textContent).toContain("initiative/usage-exports");
    expect(page.textContent).toContain("CTO's Proposal");
    expect(page.textContent).not.toContain("kept for you to delete");

    document.body.replaceChildren();
    const dropped = rendered({ ...active, state: "dropped", endedAt: "2026-11-12T11:00:00.000Z" });
    expect(dropped.textContent).toContain("kept for you to delete");
    expect(dropped.textContent).not.toContain("CTO's Proposal");
  });

  it("once confirmed with None says it publishes Task by Task", () => {
    const page = rendered({ ...INITIATIVE, state: "active" });
    expect(page.textContent).toContain("None: publishes Task by Task");
  });
});
