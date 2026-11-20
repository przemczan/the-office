import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Pipeline, Project, ProjectPipeline, Role } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleQueries } from "../../../api/people.ts";
import { pipelineQueries, projectPipelineQueries } from "../../../api/pipelines.ts";
import { aDuty } from "../../../shell/duties.fixtures.ts";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { DefaultPipelineBlock } from "./default-pipeline-block.tsx";

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

const FULL = {
  id: "full",
  name: "Full",
  description: "",
  stages: [{ name: "Implement" }, { name: "Tests" }],
} as unknown as Pipeline;

function projectPipeline(id: string, name: string, broken: readonly string[]): ProjectPipeline {
  return {
    id,
    projectId: "the-office",
    name,
    description: "",
    basePipeline: { id: "full", name: "Full" },
    stageChanges: [],
    rows: [],
    stages: [{ name: "Implement" }, { name: "Verify on Linux" }],
    broken: broken.map((text) => ({ stageChangeIndex: 0, stageIndex: null, stageKey: null, text })),
  } as unknown as ProjectPipeline;
}

const LINUX_CHECK = projectPipeline("linux-check", "Full with Linux check", []);
const SPEC_CHANGE = projectPipeline("spec-change", "Spec change", [
  "Changes Produce, which Full no longer has.",
]);

const PROJECT = {
  id: "the-office",
  name: "the-office",
  baseBranch: "main",
  publishingMode: "merge",
  defaultPipeline: "linux-check",
  kindDefaultPipelines: { feature: null, bug: "full", chore: null },
} as unknown as Project;

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function block(project: Project): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(pipelineQueries.list().queryKey, [{ ...FULL, builtOnBy: [] }]);
  queryClient.setQueryData(projectPipelineQueries.list(project.id).queryKey, [
    LINUX_CHECK,
    SPEC_CHANGE,
  ]);
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(dutyQueries.list().queryKey, [aDuty("plans", "planner")]);
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <DefaultPipelineBlock project={project} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return page;
}

function labelOf(option: Element): string | undefined {
  return document.getElementById(option.getAttribute("aria-labelledby") ?? "")?.textContent;
}

describe("the Default Pipeline block", () => {
  it("offers the Project's own Pipelines, then the office-wide ones, with no default badge", () => {
    const page = block(PROJECT);
    const picker = page.querySelector<HTMLElement>('[aria-label="Default Pipeline"]');

    expect(picker?.textContent).toBe("Full with Linux check");
    act(() => picker?.click());

    // The list opens apart from the block.
    const groups = [...document.querySelectorAll('[role="listbox"] [role="group"]')].map(
      (group) => [
        group.firstElementChild?.textContent,
        [...group.querySelectorAll('[role="option"]')].map(labelOf),
      ],
    );
    expect(groups).toEqual([
      ["the-office's Pipelines", ["Full with Linux check", "Spec change"]],
      ["Office-wide Pipelines", ["Full"]],
    ]);
    expect(document.body.textContent).not.toContain("Project default");
    const broken = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(
      (option) => labelOf(option) === "Spec change",
    );
    expect(broken?.getAttribute("aria-disabled")).toBe("true");
  });

  it("reads the default's built Stages", () => {
    expect(block(PROJECT).textContent).toContain(
      "Implement → Verify on Linux · built from Full. A new Task has no Pipeline until Angela proposes one",
    );
  });

  it("leaves the publishing mode to the Commands block's Publish group", () => {
    const page = block(PROJECT);

    expect(page.querySelector("select")).toBeNull();
    expect(page.textContent).not.toContain("Publishing");
  });

  it("flags a Broken default with why", () => {
    const page = block({ ...PROJECT, defaultPipeline: "spec-change" });

    expect(page.textContent).toContain("Spec change, the default, is Broken");
    expect(page.textContent).toContain(
      "Changes Produce, which Full no longer has. New Tasks can't follow it, and Angela proposes from the others, until it is fixed or another default is chosen.",
    );
  });

  it("gives each Kind a row, Same as every Task where it has none, and saves a change at once", async () => {
    const fetched = vi.fn<typeof fetch>(async () =>
      Response.json({
        ...PROJECT,
        kindDefaultPipelines: { feature: null, bug: null, chore: null },
      }),
    );
    vi.stubGlobal("fetch", fetched);
    const page = block(PROJECT);
    const picker = (kind: string): HTMLElement | null =>
      page.querySelector<HTMLElement>(`[aria-label="Default Pipeline for ${kind}"]`);

    expect(page.textContent).toContain("By Kind");
    expect(picker("Features")?.textContent).toBe("Same as every Task");
    expect(picker("Bugs")?.textContent).toBe("Full");
    expect(picker("Chores")?.textContent).toBe("Same as every Task");

    act(() => picker("Bugs")?.click());
    const same = [
      ...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]'),
    ].find((option) => labelOf(option) === "Same as every Task");
    await act(async () => {
      same?.click();
      await Promise.resolve();
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects/the-office/kind-default-pipeline");
    expect(request?.method).toBe("PUT");
    expect(request?.body).toBe(JSON.stringify({ kind: "bug", pipelineId: null }));
  });
});
