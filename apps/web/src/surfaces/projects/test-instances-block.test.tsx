import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  LaunchableTestTarget,
  Project,
  ProjectBranches,
  ProjectTestInstances,
  TaskSummary,
  TestInstance,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testInstanceQueries } from "../../api/test-instances.ts";
import { taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { TestInstancesBlock } from "./test-instances-block.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the branch picker's list never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const PROJECT = {
  id: "website",
  name: "Website",
  baseBranch: "main",
  mark: { label: "WE", colour: "amber" },
} as unknown as Project;

const INITIATIVE_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

const TASK_ID = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

const OFFICE: LaunchableTestTarget = {
  key: "office",
  name: "Office",
  kind: "hosted",
  entryPoint: { kind: "package-script", manifest: "package.json", script: "start", arguments: [] },
  installs: null,
};

const APP: LaunchableTestTarget = {
  key: "app",
  name: "Android app",
  kind: "build-to-install",
  entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
  installs: null,
};

const RUNNING: TestInstance = {
  id: "11111111-2222-4333-8444-555555555555",
  initiativeId: INITIATIVE_ID,
  branch: "initiative/checkout",
  projectId: "website",
  targetKey: "office",
  targetName: "Office",
  kind: "hosted",
  state: "running",
  commit: "a1b2c3d4e5f6",
  port: 4400,
  failedReason: null,
  launchedBy: { kind: "user", user: null },
  launchedAt: "2026-11-20T14:02:00.000Z",
  runningAt: "2026-11-20T14:03:00.000Z",
  endedAt: null,
  files: [],
  filesRemoved: false,
  runAs: null,
  device: null,
  buildInstanceId: null,
  builtFor: null,
};

const STOPPED: TestInstance = {
  ...RUNNING,
  id: "22222222-3333-4444-8555-666666666666",
  state: "stopped",
  port: null,
  endedAt: "2026-11-20T13:00:00.000Z",
};

const ON_FIX: TestInstance = {
  ...STOPPED,
  id: "33333333-4444-4555-8666-777777777777",
  initiativeId: null,
  branch: "fix-login",
};

function shownWith(
  branches: ProjectTestInstances["branches"],
  { runEnvironmentOn = true, targets = [OFFICE, APP] } = {},
): ProjectTestInstances {
  return {
    runEnvironmentOn,
    targets,
    branches,
    initiatives: [{ id: INITIATIVE_ID, name: "Checkout" }],
  };
}

const LAUNCHED = shownWith([
  { name: "initiative/checkout", branchCommit: "f00dfeed0000", instances: [RUNNING, STOPPED] },
  { name: "fix-login", branchCommit: null, instances: [ON_FIX] },
]);

const BRANCHES: ProjectBranches = {
  baseBranch: { name: "main", kind: "local", commit: "aaaa" },
  branches: [
    { name: "fix-login", kind: "local", commit: "bbbb" },
    { name: "origin/main", kind: "remote", commit: "aaaa" },
    { name: "origin/fix-login", kind: "remote", commit: "bbbb" },
    { name: "origin/add-search", kind: "remote", commit: "cccc" },
  ],
  fetchProblem: null,
};

/** The card with its list already read, the service answering as `answer` says. */
async function rendered(
  shown: ProjectTestInstances,
  answer: (url: string, method: string) => Response,
  linkedTo?: string,
  tasks?: readonly TaskSummary[],
): Promise<{ page: HTMLElement; fetched: ReturnType<typeof vi.fn<typeof fetch>> }> {
  const fetched = vi.fn<typeof fetch>((input, request) =>
    Promise.resolve(answer(String(input), request?.method ?? "GET")),
  );
  vi.stubGlobal("fetch", fetched);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(testInstanceQueries.ofProject(PROJECT.id).queryKey, shown);
  if (tasks) queryClient.setQueryData(taskQueries.list().queryKey, [...tasks]);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ToastProvider>
          <TestInstancesBlock project={PROJECT} linkedTo={linkedTo} />
        </ToastProvider>
      ),
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
  return { page, fetched };
}

function groupOf(page: HTMLElement, branch: string): HTMLElement {
  const group = page.querySelector<HTMLElement>(`section[aria-label="${branch}"]`);
  if (!group) throw new Error(`There is no group for ${branch}.`);
  return group;
}

function rowOf(place: HTMLElement, targetName: string): HTMLElement {
  const row = place.querySelector<HTMLElement>(`li[aria-label="${targetName}"]`);
  if (!row) throw new Error(`There is no row for ${targetName}.`);
  return row;
}

function buttonOf(place: Element, name: string): HTMLButtonElement | undefined {
  return [...place.querySelectorAll("button")].find((found) =>
    found.textContent.trim().startsWith(name),
  );
}

function branchPicker(): HTMLInputElement {
  const label = [...document.querySelectorAll("label")].find(
    ({ textContent }) => textContent.trim() === "Branch",
  );
  const picker = label && document.getElementById(label.htmlFor);
  if (!(picker instanceof HTMLInputElement)) throw new Error("No Branch picker.");
  return picker;
}

function optionNames(): (string | undefined)[] {
  return [...document.querySelectorAll('[role="option"]')].map(
    ({ id }) => document.getElementById(`${id}-label`)?.textContent,
  );
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve));
  });
}

/** Until the picker's list holds the branches read, as the read answers in its own time. */
async function branchesListed(): Promise<void> {
  for (let tries = 0; tries < 50 && !optionNames().includes("add-search"); tries += 1) {
    await settled();
  }
}

describe("a Project's Test instances", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it("shows the base branch until another is picked, then the other branches' instances", async () => {
    const { page } = await rendered(LAUNCHED, notFound);

    expect(branchPicker().value).toBe("main");
    expect(rowOf(groupOf(page, "main"), "Office").textContent).toContain("Not launched yet");
    const picked = groupOf(page, "initiative/checkout");
    const office = rowOf(picked, "Office");
    expect(office.textContent).toContain("Running");
    expect(office.textContent).toContain("Newer commits on the branch");
    expect(office.textContent).toContain("1 earlier");
    expect(picked.querySelector('li[aria-label="Android app"]')).toBeNull();
    const fix = groupOf(page, "fix-login");
    expect(rowOf(fix, "Office").textContent).toContain("Stopped");
    expect(fix.querySelector('li[aria-label="Android app"]')).toBeNull();
  });

  it("picks a linked instance's branch and brings its row into view", async () => {
    const scrolled = vi.fn<(this: Element) => void>(function (this: Element) {});
    Element.prototype.scrollIntoView = scrolled;

    const { page } = await rendered(LAUNCHED, notFound, ON_FIX.id);

    expect(branchPicker().value).toBe("fix-login");
    expect(scrolled).toHaveBeenCalledOnce();
    expect(scrolled.mock.contexts[0]).toBe(rowOf(groupOf(page, "fix-login"), "Office"));
  });

  it("unfolds the earlier instances when the linked one is among them", async () => {
    const scrolled = vi.fn<(this: Element) => void>(function (this: Element) {});
    Element.prototype.scrollIntoView = scrolled;

    const { page } = await rendered(LAUNCHED, notFound, STOPPED.id);

    const earlier = page.querySelector(`[data-test-instance="${STOPPED.id}"]`);
    expect(earlier?.closest('[aria-label="Earlier Office"]')).not.toBeNull();
    expect(scrolled.mock.contexts).toEqual([earlier]);
  });

  it("says an instance linked to an Initiative is in it, linking to its page", async () => {
    const { page } = await rendered(LAUNCHED, notFound);

    const link = rowOf(
      groupOf(page, "initiative/checkout"),
      "Office",
    ).querySelector<HTMLAnchorElement>(".project-test-instances-initiative a");
    expect(link?.parentElement?.textContent).toBe("in Checkout");
    expect(link?.getAttribute("href")).toBe(`/work/initiatives/${INITIATIVE_ID}`);
    expect(
      rowOf(groupOf(page, "fix-login"), "Office").querySelector(
        ".project-test-instances-initiative",
      ),
    ).toBeNull();
  });

  it("says an instance an Action launched is Run as it, linking to that Action's History", async () => {
    const { page } = await rendered(
      shownWith([
        {
          name: "fix-login",
          branchCommit: null,
          instances: [{ ...ON_FIX, runAs: { actionKey: "install-phone", actionName: "Install" } }],
        },
      ]),
      notFound,
    );

    const runAs = rowOf(groupOf(page, "fix-login"), "Office").querySelector(
      ".project-test-instances-run-as",
    );
    expect(runAs?.textContent).toBe("Run as Install");
    expect(runAs?.querySelector("a")?.getAttribute("href")).toBe(
      `/projects/${PROJECT.id}/actions/install-phone`,
    );
  });

  it("reads the branches only once the picker opens, the base branch first, remote ones by name", async () => {
    const { fetched } = await rendered(LAUNCHED, (url) =>
      url.includes("/branches") ? Response.json(BRANCHES) : notFound(),
    );
    expect(fetched.mock.calls.some(([url]) => String(url).includes("/branches"))).toBe(false);

    act(() => branchPicker().click());
    await branchesListed();

    expect(fetched.mock.calls.map(([url]) => String(url))).toContain(
      "/api/projects/website/branches?fetch=1",
    );
    expect(optionNames()).toEqual(["main", "add-search", "fix-login", "initiative/checkout"]);
  });

  it("launches on the branch picked, posting the branch and the target's key", async () => {
    const { page, fetched } = await rendered(LAUNCHED, (url, method) => {
      if (url.includes("/branches")) return Response.json(BRANCHES);
      if (method === "POST")
        return Response.json({ ...ON_FIX, state: "building" }, { status: 201 });
      return Response.json(LAUNCHED);
    });
    act(() => branchPicker().click());
    await branchesListed();
    const addSearch = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      ({ textContent }) => textContent.startsWith("add-search"),
    );
    act(() => addSearch?.click());
    await settled();

    const row = rowOf(groupOf(page, "add-search"), "Android app");
    expect(row.textContent).toContain("Not launched yet");
    act(() => buttonOf(row, "Launch")?.click());
    await settled();

    const launch = fetched.mock.calls.find(([, request]) => request?.method === "POST");
    expect(String(launch?.[0])).toBe("/api/projects/website/test-instances");
    expect(JSON.parse(String(launch?.[1]?.body))).toEqual({
      branch: "add-search",
      targetKey: "app",
    });
  });

  it("launches on a Task choice's branch and lists that branch's instances", async () => {
    const task = {
      id: TASK_ID,
      title: "Fix the login form",
      projectId: "website",
      state: "in-progress",
    } as unknown as TaskSummary;
    const taskBranches: ProjectBranches = {
      ...BRANCHES,
      branches: [
        ...BRANCHES.branches,
        { name: `office/${TASK_ID}`, kind: "local", commit: "dddd" },
      ],
    };
    const { page, fetched } = await rendered(
      LAUNCHED,
      (url, method) => {
        if (url.includes("/branches")) return Response.json(taskBranches);
        if (method === "POST")
          return Response.json({ ...ON_FIX, state: "building" }, { status: 201 });
        return notFound();
      },
      undefined,
      [task],
    );
    act(() => branchPicker().click());
    await branchesListed();
    const taskChoice = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      ({ textContent }) => textContent.startsWith("Fix the login form"),
    );
    act(() => taskChoice?.click());
    await settled();

    expect(branchPicker().value).toBe("Fix the login form");
    const row = rowOf(groupOf(page, `office/${TASK_ID}`), "Android app");
    act(() => buttonOf(row, "Launch")?.click());
    await settled();

    const launch = fetched.mock.calls.find(([, request]) => request?.method === "POST");
    expect(JSON.parse(String(launch?.[1]?.body))).toEqual({
      branch: `office/${TASK_ID}`,
      targetKey: "app",
    });
  });

  it("starts on the base branch when nothing was launched", async () => {
    const { page } = await rendered(shownWith([]), notFound);

    expect(branchPicker().value).toBe("main");
    expect(rowOf(groupOf(page, "main"), "Office").textContent).toContain("Not launched yet");
  });

  it("holds a Hosted launch, saying why, while the Run environment is Off", async () => {
    const { page } = await rendered(shownWith([], { runEnvironmentOn: false }), notFound);

    expect(page.textContent).toContain("Needs Run environment On to launch.");
    const launch = buttonOf(rowOf(page, "Office"), "Launch");
    expect(launch?.disabled).toBe(true);
    expect(launch?.title).toBe("Needs Run environment On in Website");
    expect(buttonOf(rowOf(page, "Android app"), "Launch")?.disabled).toBe(false);
  });

  it("links to the Test targets card when there is nothing to launch", async () => {
    const { page } = await rendered(shownWith([], { targets: [] }), notFound);

    expect(page.textContent).toContain(
      "Website has no Hosted or Build to install test targets yet.",
    );
    const link = [...page.querySelectorAll("a")].find(({ textContent }) =>
      textContent.includes("Add one under Test targets"),
    );
    expect(link?.getAttribute("href")).toBe("/projects/website/test-targets#test-targets");
    expect(page.querySelector('[role="combobox"]')).toBeNull();
  });

  describe("an Install on a device", () => {
    const PIXEL_DEVICE = {
      projectDeviceId: "5b0c6d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e",
      name: "Pixel 8",
      kind: "android-wireless" as const,
    };
    const INSTALL: LaunchableTestTarget = {
      key: "on-pixel",
      name: "Install on Pixel",
      kind: "install-on-a-device",
      entryPoint: null,
      installs: {
        buildTargetKey: "app",
        buildTargetName: "Android app",
        projectDeviceId: PIXEL_DEVICE.projectDeviceId,
        device: PIXEL_DEVICE,
      },
    };
    const BUILD: TestInstance = {
      ...STOPPED,
      id: "44444444-5555-4666-8777-888888888888",
      targetKey: "app",
      targetName: "Android app",
      kind: "build-to-install",
      state: "building",
      builtFor: { targetKey: "on-pixel", targetName: "Install on Pixel" },
    };
    const INSTALLING: TestInstance = {
      ...STOPPED,
      id: "55555555-6666-4777-8888-999999999999",
      targetKey: "on-pixel",
      targetName: "Install on Pixel",
      kind: "install-on-a-device",
      state: "installing",
      endedAt: null,
      device: PIXEL_DEVICE,
      buildInstanceId: BUILD.id,
    };

    it("says Installing on the device, with Stop and Log, and Built for on its build", async () => {
      const { page } = await rendered(
        shownWith([{ name: "main", branchCommit: "aaaa", instances: [INSTALLING, BUILD] }], {
          targets: [INSTALL, APP],
        }),
        notFound,
      );

      const row = rowOf(page, "Install on Pixel");
      expect(row.textContent).toContain("Installing");
      expect(row.textContent).toContain("on Pixel 8");
      expect(buttonOf(row, "Stop")).toBeDefined();
      expect(buttonOf(row, "Log")).toBeDefined();
      expect(rowOf(page, "Android app").textContent).toContain("Built for Install on Pixel");
    });

    it("says Installed on the device once it is done", async () => {
      const installed: TestInstance = { ...INSTALLING, state: "installed" };
      const { page } = await rendered(
        shownWith([{ name: "main", branchCommit: "aaaa", instances: [installed] }], {
          targets: [INSTALL],
        }),
        notFound,
      );

      const row = rowOf(page, "Install on Pixel");
      expect(row.textContent).toContain("Installed");
      expect(row.textContent).toContain("on Pixel 8");
    });
  });
});
