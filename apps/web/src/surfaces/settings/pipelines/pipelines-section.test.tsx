import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { OfficeWidePipeline, RoleCardOptions, StageTemplate } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleCardQueries, roleQueries } from "../../../api/people.ts";
import { pipelineQueries, stageTemplateQueries } from "../../../api/pipelines.ts";
import { PageHeadingProvider } from "../../../shell/page-heading.tsx";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { PipelinesSection } from "./pipelines-section.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PIPELINES = [
  { id: "full", name: "Full", description: "", stages: [], builtOnBy: [] },
  { id: "quick", name: "Quick", description: "", stages: [], builtOnBy: [] },
] as unknown as OfficeWidePipeline[];

const TEMPLATES: StageTemplate[] = [
  {
    id: "t-1",
    stage: {
      kind: "script",
      key: "tests",
      name: "Run the tests",
      optional: false,
      command: "test",
    },
  },
  {
    id: "t-2",
    stage: { kind: "gate", key: "review", name: "Look it over", optional: false },
  },
];

async function rendered(address: string): Promise<HTMLElement> {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input) =>
      Promise.resolve(
        Response.json(String(input).endsWith("/check") ? { problems: [], breaks: [] } : []),
      ),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(pipelineQueries.list().queryKey, PIPELINES);
  queryClient.setQueryData(stageTemplateQueries.list().queryKey, TEMPLATES);
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  queryClient.setQueryData(dutyQueries.list().queryKey, []);
  queryClient.setQueryData(roleCardQueries.options().queryKey, {} as RoleCardOptions);
  const root = createRootRoute();
  const section = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: PipelinesSection });
  const router = createRouter({
    routeTree: root.addChildren([
      section("settings/pipelines"),
      section("settings/pipelines/$pipelineId"),
      section("settings/pipelines/stage-templates"),
      section("settings/pipelines/stage-templates/$stageTemplateId"),
    ]),
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <PageHeadingProvider setPageHeading={() => undefined}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </PageHeadingProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

function tabs(page: HTMLElement): string[] {
  return [...(page.querySelector('[role="tablist"]')?.querySelectorAll('[role="tab"]') ?? [])].map(
    (tab) => tab.textContent ?? "",
  );
}

function selectedTab(page: HTMLElement): string {
  return (
    page.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]')?.textContent ?? ""
  );
}

describe("Settings › Pipelines as two tabs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("opens on Pipelines, listing only the Pipelines, with each tab's count", async () => {
    const page = await rendered("/settings/pipelines");
    expect(tabs(page)).toEqual(["Pipelines2", "Stage templates2"]);
    expect(selectedTab(page)).toContain("Pipelines");
    expect(page.textContent).toContain("Office-wide Pipelines");
    expect(page.textContent).not.toContain("Run the tests");
    expect(page.textContent).toContain("All Pipelines");
  });

  it("opens the first Stage template when none is in the address", async () => {
    const page = await rendered("/settings/pipelines/stage-templates");
    expect(selectedTab(page)).toContain("Stage templates");
    expect(page.textContent).not.toContain("Office-wide Pipelines");
    expect(page.textContent).toContain("All Stage templates");
    const picked = page.querySelector('[aria-current="page"]');
    expect(picked?.textContent).toContain("Run the tests");
  });

  it("opens the Stage templates tab at a template's address, with that template open", async () => {
    const page = await rendered("/settings/pipelines/stage-templates/t-2");
    expect(selectedTab(page)).toContain("Stage templates");
    const picked = page.querySelector('[aria-current="page"]');
    expect(picked?.textContent).toContain("Look it over");
  });

  it("switches to the other tab's address when a tab is pressed", async () => {
    const page = await rendered("/settings/pipelines");
    const templatesTab = [...page.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) =>
      tab.textContent?.startsWith("Stage templates"),
    );
    await act(async () => {
      templatesTab?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(selectedTab(page)).toContain("Stage templates");
    expect(page.textContent).toContain("Run the tests");
  });
});
