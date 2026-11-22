import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  Initiative,
  InitiativeTestInstances,
  InitiativeTestTarget,
  Project,
  TestInstance,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testInstanceQueries } from "../../api/test-instances.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { InitiativeTestInstancesBlock } from "./initiative-test-instances-block.tsx";
import { NO_INITIATIVE_BRANCH, testInstancesStartOpen } from "./initiative-test-instances-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE = {
  id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  name: "Usage exports",
  state: "active",
  projectIds: ["website", "admin-panel"],
  shortName: "usage-exports",
  branches: [
    {
      projectId: "website",
      branch: "initiative/usage-exports",
      madeAt: "2026-05-01T09:00:00.000Z",
    },
    {
      projectId: "admin-panel",
      branch: "initiative/usage-exports",
      madeAt: "2026-05-01T09:00:00.000Z",
    },
  ],
} as unknown as Initiative;

const ALL_ON = {
  "connected-devices": true,
  "test-targets": true,
  "github-issues": true,
  "run-environment": true,
};

const PROJECTS = [
  { id: "website", name: "Website", mark: { label: "WE", colour: "amber" }, features: ALL_ON },
  {
    id: "admin-panel",
    name: "Admin panel",
    mark: { label: "AP", colour: "teal" },
    features: ALL_ON,
  },
] as unknown as Project[];

/** The Projects with Test targets switched off for those named. */
function withTestTargetsOff(...projectIds: readonly string[]): Project[] {
  return PROJECTS.map((project) =>
    projectIds.includes(project.id)
      ? { ...project, features: { ...project.features, "test-targets": false } }
      : project,
  );
}

const OFFICE: InitiativeTestTarget = {
  key: "office",
  name: "Office",
  kind: "hosted",
  entryPoint: { kind: "package-script", manifest: "package.json", script: "start", arguments: [] },
  instances: [],
};

const BUILDING: TestInstance = {
  id: "11111111-2222-4333-8444-555555555555",
  initiativeId: INITIATIVE.id,
  branch: "initiative/checkout",
  projectId: "website",
  targetKey: "office",
  targetName: "Office",
  kind: "hosted",
  state: "building",
  commit: null,
  port: 4400,
  failedReason: null,
  launchedBy: { kind: "user", user: null },
  launchedAt: "2026-11-20T14:02:00.000Z",
  runningAt: null,
  endedAt: null,
  files: [],
  filesRemoved: false,
};

const RUNNING: TestInstance = {
  ...BUILDING,
  state: "running",
  commit: "a1b2c3d4e5f6",
  runningAt: "2026-11-20T14:03:00.000Z",
};

const APP: InitiativeTestTarget = {
  key: "app",
  name: "Android app",
  kind: "build-to-install",
  entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
  instances: [],
};

const BUILT: TestInstance = {
  ...BUILDING,
  id: "22222222-3333-4444-8555-666666666666",
  targetKey: "app",
  targetName: "Android app",
  kind: "build-to-install",
  state: "built",
  commit: "a1b2c3d4e5f6",
  port: null,
  endedAt: "2026-11-20T14:09:00.000Z",
  files: [
    { name: "app-debug.apk", size: 4404019 },
    { name: "app-release.apk", size: 2048 },
  ],
};

/** The Android app's build in a Project whose Run environment is Off, which a build doesn't need. */
function builds(instances: readonly TestInstance[]): InitiativeTestInstances {
  return {
    projects: [
      {
        projectId: "website",
        runEnvironmentOn: false,
        branchCommit: null,
        targets: [{ ...APP, instances: [...instances] }],
      },
    ],
  };
}

function listed(
  instances: readonly TestInstance[],
  runEnvironmentOn = true,
  branchCommit: string | null = null,
): InitiativeTestInstances {
  return {
    projects: [
      {
        projectId: "website",
        runEnvironmentOn,
        branchCommit,
        targets: [{ ...OFFICE, instances: [...instances] }],
      },
    ],
  };
}

/** The block on its page, with the list already read, the service answering as `answer` says. */
async function rendered(
  shown: InitiativeTestInstances,
  answer: (url: string, method: string) => Response,
  linkedTo?: string,
  projects: readonly Project[] = PROJECTS,
  initiative: Initiative = INITIATIVE,
): Promise<{ page: HTMLElement; fetched: ReturnType<typeof vi.fn<typeof fetch>> }> {
  const fetched = vi.fn<typeof fetch>((input, request) =>
    Promise.resolve(answer(String(input), request?.method ?? "GET")),
  );
  vi.stubGlobal("fetch", fetched);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(testInstanceQueries.ofInitiative(INITIATIVE.id).queryKey, shown);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ToastProvider>
          <InitiativeTestInstancesBlock
            initiative={initiative}
            projects={projects}
            linkedTo={linkedTo}
          />
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

function rowOf(page: HTMLElement, targetName: string): HTMLElement {
  const row = page.querySelector<HTMLElement>(`li[aria-label="${targetName}"]`);
  if (!row) throw new Error(`There is no row for ${targetName}.`);
  return row;
}

/** By the words it starts with: a Button also holds its spinner's styles. */
function buttonOf(place: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...place.querySelectorAll("button")].find((found) =>
    found.textContent.trim().startsWith(name),
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

describe("the Initiative page's Test instances", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it("leaves out a Project with Test targets switched off", async () => {
    const both: InitiativeTestInstances = {
      projects: [
        ...listed([]).projects,
        { projectId: "admin-panel", runEnvironmentOn: true, branchCommit: null, targets: [APP] },
      ],
    };
    const { page } = await rendered(both, notFound, undefined, withTestTargetsOff("website"));
    await settled();

    expect(page.textContent).toContain("Admin panel");
    expect(page.textContent).not.toContain("Website");
    expect(page.querySelector('li[aria-label="Office"]')).toBeNull();
    expect(rowOf(page, "Android app")).toBeDefined();
  });

  it("is hidden while no Project of the Initiative has Test targets switched on", async () => {
    const { page } = await rendered(
      listed([RUNNING]),
      notFound,
      undefined,
      withTestTargetsOff("website", "admin-panel"),
    );
    await settled();

    expect(page.textContent).not.toContain("Test instances");
  });

  it("says where test instances launch while no Project is on an Initiative's branch", async () => {
    const { page } = await rendered({ projects: [] }, notFound, undefined, PROJECTS, {
      ...INITIATIVE,
      branches: [],
    });
    await settled();

    expect(page.textContent).toContain("Test instances");
    expect(page.textContent).toContain(NO_INITIATIVE_BRANCH);
  });

  it("opens the fold at a linked instance and brings its row into view", async () => {
    const scrolled = vi.fn<(this: Element) => void>(function (this: Element) {});
    Element.prototype.scrollIntoView = scrolled;

    // Nothing is running, so the fold would start closed.
    expect(testInstancesStartOpen(builds([BUILT]).projects)).toBe(false);
    const { page } = await rendered(builds([BUILT]), notFound, BUILT.id);
    await settled();

    expect(page.querySelector(".record-fold-body")?.hasAttribute("hidden")).toBe(false);
    expect(scrolled.mock.contexts).toEqual([rowOf(page, "Android app")]);
  });

  it("says when the branch has moved past the running instance's commit, and not before", async () => {
    const atTip = await rendered(listed([RUNNING], true, RUNNING.commit), notFound);
    expect(rowOf(atTip.page, "Office").textContent).not.toContain("Newer commits on the branch");
    document.body.replaceChildren();

    const behind = await rendered(listed([RUNNING], true, "f00dfeed0000"), notFound);

    expect(rowOf(behind.page, "Office").textContent).toContain("Newer commits on the branch");
  });

  it("launches a target not launched yet, and its row turns Building", async () => {
    let launched = false;
    const { page, fetched } = await rendered(listed([]), (url, method) => {
      if (method === "POST") {
        launched = true;
        return Response.json(BUILDING, { status: 201 });
      }
      return Response.json(listed(launched ? [BUILDING] : []));
    });
    const row = rowOf(page, "Office");
    expect(row.textContent).toContain("Not launched yet");
    expect(row.textContent).toContain("package.json › start");

    act(() => buttonOf(row, "Launch")?.click());
    await settled();

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/initiatives/${INITIATIVE.id}/test-instances`);
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({
      projectId: "website",
      targetKey: "office",
    });
    expect(rowOf(page, "Office").textContent).toContain("Building");
    expect(buttonOf(rowOf(page, "Office"), "Stop")).toBeDefined();
    expect(buttonOf(rowOf(page, "Office"), "Log")).toBeDefined();
    expect(buttonOf(rowOf(page, "Office"), "Launch")).toBeUndefined();
  });

  it("shows a refused launch as a toast with the service's reason, the row as it was", async () => {
    const reason = "2 test instances are building or running, at most 2 at once.";
    const { page } = await rendered(listed([]), () =>
      Response.json({ message: reason, reasons: [reason] }, { status: 409 }),
    );

    act(() => buttonOf(rowOf(page, "Office"), "Launch")?.click());
    await settled();

    expect(page.querySelector(".toasts")?.textContent).toContain("Office can't launch");
    expect(page.querySelector(".toasts")?.textContent).toContain(reason);
    expect(rowOf(page, "Office").textContent).toContain("Not launched yet");
  });

  it("shows a Running instance's address as plain text with Open, Stop and Log", async () => {
    const { page } = await rendered(listed([RUNNING]), () => Response.json(listed([RUNNING])));
    const row = rowOf(page, "Office");

    expect(row.textContent).toContain("Running");
    expect(row.textContent).toContain(`${window.location.hostname}:4400`);
    expect(row.querySelector("a")).toBeNull();
    expect(row.textContent).toContain("a1b2c3d");
    expect(buttonOf(row, "Open")).toBeDefined();
    expect(buttonOf(row, "Stop")).toBeDefined();
    expect(buttonOf(row, "Log")).toBeDefined();
  });

  it("stops an instance without asking, saying so in a toast", async () => {
    const stopped: TestInstance = {
      ...RUNNING,
      state: "stopped",
      port: null,
      endedAt: RUNNING.runningAt,
    };
    const { page, fetched } = await rendered(listed([RUNNING]), (_url, method) =>
      method === "POST" ? Response.json(stopped) : Response.json(listed([stopped])),
    );

    act(() => buttonOf(rowOf(page, "Office"), "Stop")?.click());
    await settled();

    const [url] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/test-instances/${RUNNING.id}/stop`);
    expect(page.querySelector(".toasts")?.textContent).toContain("Office stopped.");
    expect(rowOf(page, "Office").textContent).toContain("Stopped");
    expect(buttonOf(rowOf(page, "Office"), "Launch again")).toBeDefined();
  });

  it("holds Launch, saying why, while the Project's Run environment isn't On", async () => {
    const { page } = await rendered(listed([], false), () => Response.json(listed([], false)));

    expect(page.textContent).toContain("Needs Run environment On to launch.");
    const launch = buttonOf(rowOf(page, "Office"), "Launch");
    expect(launch?.disabled).toBe(true);
    expect(launch?.title).toBe("Needs Run environment On in Website");
  });

  it("launches a Build to install target with the Run environment Off, and stops it while Building", async () => {
    const building: TestInstance = { ...BUILT, state: "building", endedAt: null, files: [] };
    const { page } = await rendered(builds([]), () => Response.json(builds([building])));

    expect(page.textContent).not.toContain("Needs Run environment On to launch.");
    const row = rowOf(page, "Android app");
    expect(row.textContent).toContain("Build to install");
    expect(row.textContent).toContain("./gradlew assembleDebug");
    expect(buttonOf(row, "Launch")?.disabled).toBe(false);
    document.body.replaceChildren();

    const shown = await rendered(builds([building]), notFound);
    const buildingRow = rowOf(shown.page, "Android app");
    expect(buildingRow.textContent).toContain("Building");
    expect(buttonOf(buildingRow, "Stop")).toBeDefined();
    expect(buttonOf(buildingRow, "Log")).toBeDefined();
    expect(buttonOf(buildingRow, "Open")).toBeUndefined();
  });

  it("gives a Built instance's files each a Download link and a QR code, and no Open", async () => {
    const { page } = await rendered(builds([BUILT]), notFound);
    const row = rowOf(page, "Android app");

    expect(row.textContent).toContain("Built");
    expect(buttonOf(row, "Open")).toBeUndefined();
    expect(buttonOf(row, "Stop")).toBeUndefined();
    expect(row.querySelector(".test-instance-address")).toBeNull();
    const downloads = [...row.querySelectorAll<HTMLAnchorElement>("a[download]")];
    expect(downloads.map((link) => [link.getAttribute("href"), link.download])).toEqual([
      [`/api/test-instances/${BUILT.id}/files/app-debug.apk`, "app-debug.apk"],
      [`/api/test-instances/${BUILT.id}/files/app-release.apk`, "app-release.apk"],
    ]);
    expect(downloads.every((link) => link.textContent.includes("Download"))).toBe(true);
    const file = row.querySelector<HTMLElement>('li[aria-label="app-debug.apk"]');
    expect(file && buttonOf(file, "QR code")).toBeDefined();
    expect(buttonOf(row, "Launch again")).toBeDefined();
  });

  it("shows a file's link as a QR code with how long it works and Copy link", async () => {
    const url = "http://192.168.1.20:4390/api/sign-in/test-builds/abc";
    const { page, fetched } = await rendered(builds([BUILT]), () =>
      Response.json({ kind: "link", url, expiresAt: "2026-11-20T15:09:00.000Z" }),
    );
    const file = page.querySelector<HTMLElement>('li[aria-label="app-debug.apk"]');

    act(() => (file && buttonOf(file, "QR code"))?.click());
    await settled();

    const [called, request] = fetched.mock.calls[0] ?? [];
    expect(called).toBe(`/api/test-instances/${BUILT.id}/files/app-debug.apk/link`);
    expect(request?.method).toBe("POST");
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Install app-debug.apk on a phone");
    expect(dialog?.textContent).toContain("Works for this file only, for 1 hour.");
    expect(dialog?.textContent).toContain(url);
    expect(dialog?.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(dialog && buttonOf(dialog, "Copy link")).toBeDefined();
  });

  it("says to open The Office at its LAN address at localhost, with no QR code", async () => {
    const { page } = await rendered(builds([BUILT]), () =>
      Response.json({ kind: "needs-lan-address" }),
    );
    const file = page.querySelector<HTMLElement>('li[aria-label="app-debug.apk"]');

    act(() => (file && buttonOf(file, "QR code"))?.click());
    await settled();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain(
      "A phone can't reach localhost. Open The Office at its LAN address to make a QR code that works there.",
    );
    expect(dialog?.querySelector("img")).toBeNull();
    expect(dialog && buttonOf(dialog, "Copy link")).toBeUndefined();
  });

  it("says a Built instance's files were removed, with no Download or QR code", async () => {
    const { page } = await rendered(builds([{ ...BUILT, filesRemoved: true }]), notFound);
    const row = rowOf(page, "Android app");

    expect(row.textContent).toContain("Built");
    expect(row.textContent).toContain("Files removed");
    expect(row.querySelector("a[download]")).toBeNull();
    expect(buttonOf(row, "QR code")).toBeUndefined();
  });
});
