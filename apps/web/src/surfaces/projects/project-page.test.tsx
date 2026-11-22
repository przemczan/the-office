import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import type { Project } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageHeadingProvider } from "../../shell/page-heading.tsx";
import { ToastProvider } from "../../shell/toasts.tsx";
import { ProjectPage } from "./project-page.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT: Project = {
  id: "shop",
  name: "Shop",
  path: "/projects/shop",
  baseBranch: "main",
  mark: { label: "SH", colour: "teal" },
  installCommand: "npm ci",
  commands: [],
  installInputs: [],
  publishingMode: "merge",
  defaultPipeline: "full",
  icon: { light: null, dark: null },
  logo: { light: null, dark: null },
  repositoryUrl: null,
  beforePublishingCommand: "",
  afterPublishingCommand: "",
  deleteMergedBranches: false,
  environment: { set: [], unset: [], prependPath: [] },
  useProjectSkills: true,
  projectSkillsOff: [],
  projectDefault: null,
  useForEveryRole: false,
  roleOverrides: [],
  runEnvironment: "off",
  features: {
    "connected-devices": false,
    "test-targets": false,
    "github-issues": true,
    "run-environment": false,
    actions: true,
  },
  projectLimit: 1,
  addedAt: "2026-11-01T10:00:00.000Z",
  codeHost: "GitHub",
  kindDefaultPipelines: { feature: null, bug: null, chore: null },
  defaultPipelineOfKind: { feature: "full", bug: "full", chore: "full" },
  issueSettings: {
    autoImportLabel: null,
    closeOnDone: true,
    commentOnStartAndDone: false,
    closeOnDrop: false,
  },
};

let shownProject: Project = PROJECT;
let root: Root | undefined;
let router: AnyRouter;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  shownProject = PROJECT;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function open(address: string): Promise<HTMLElement> {
  vi.stubGlobal("fetch", (input: string) => {
    const url = new URL(input, "http://office.test");
    if (url.pathname === "/api/projects/shop") return Promise.resolve(Response.json(shownProject));
    return Promise.resolve(Response.json({ message: "Not here." }, { status: 404 }));
  });
  const rootRoute = createRootRoute({ component: Outlet });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "projects/$projectId",
    component: ProjectPage,
  });
  const section = (path: string) =>
    createRoute({
      getParentRoute: () => projectRoute,
      path,
      component: () => <p className="shown-section">{path}</p>,
    });
  router = createRouter({
    routeTree: rootRoute.addChildren([
      projectRoute.addChildren([
        section("/"),
        section("issues"),
        section("run-environment"),
        section("test-targets"),
        section("actions"),
        section("features"),
      ]),
    ]),
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <PageHeadingProvider setPageHeading={() => undefined}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </PageHeadingProvider>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(page.querySelector('[role="tablist"]')).not.toBeNull();
  });
  return page;
}

function tabs(page: HTMLElement): string[] {
  return [...page.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
}

describe("a Project's tabs and its switched-off features", () => {
  it("leaves out the tabs of the features switched off, with Features before Appearance", async () => {
    const page = await open("/projects/shop");

    expect(tabs(page)).toContain("GitHub issues");
    expect(tabs(page)).not.toContain("Run environment");
    expect(tabs(page)).not.toContain("Test targets");
    expect(tabs(page).slice(-2)).toEqual(["Features", "Appearance"]);
  });

  it("says a switched-off feature's section is off at its address, linking to Features", async () => {
    const page = await open("/projects/shop/test-targets");

    expect(page.querySelector(".shown-section")).toBeNull();
    expect(page.textContent).toContain("Test targets are switched off for «Shop».");
    const link = [...page.querySelectorAll("a")].find((found) =>
      found.textContent.includes("Features"),
    );
    expect(link?.getAttribute("href")).toBe("/projects/shop/features");
    expect(router.state.location.pathname).toBe("/projects/shop/test-targets");
  });

  it("shows the Actions tab after Test targets, and says so at its address once switched off", async () => {
    shownProject = { ...PROJECT, features: { ...PROJECT.features, "test-targets": true } };
    const on = await open("/projects/shop/actions");
    expect(tabs(on).indexOf("Actions")).toBe(tabs(on).indexOf("Test targets") + 1);
    expect(on.querySelector(".shown-section")?.textContent).toBe("actions");
    act(() => root?.unmount());
    document.body.replaceChildren();

    shownProject = { ...PROJECT, features: { ...PROJECT.features, actions: false } };
    const off = await open("/projects/shop/actions");
    expect(tabs(off)).not.toContain("Actions");
    expect(off.textContent).toContain("Actions are switched off for «Shop».");
  });

  it("says Run environment is switched off at its address", async () => {
    const page = await open("/projects/shop/run-environment");

    expect(page.textContent).toContain("Run environment is switched off for «Shop».");
  });

  it("keeps Run environment's tab while it is Not decided yet", async () => {
    shownProject = { ...PROJECT, runEnvironment: "not-decided" };
    const page = await open("/projects/shop/run-environment");

    expect(tabs(page)).toContain("Run environment");
    expect(page.querySelector(".shown-section")?.textContent).toBe("run-environment");
  });

  it("shows a section whose feature is on", async () => {
    const page = await open("/projects/shop/issues");

    expect(page.querySelector(".shown-section")?.textContent).toBe("issues");
  });
});
