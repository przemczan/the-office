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
} as unknown as Initiative;

const PROJECTS = [
  { id: "website", name: "Website", mark: { label: "WE", colour: "amber" } },
  { id: "admin-panel", name: "Admin panel", mark: { label: "AP", colour: "teal" } },
] as unknown as Project[];

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
};

const RUNNING: TestInstance = {
  ...BUILDING,
  state: "running",
  commit: "a1b2c3d4e5f6",
  runningAt: "2026-11-20T14:03:00.000Z",
};

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
          <InitiativeTestInstancesBlock initiative={INITIATIVE} projects={PROJECTS} />
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
});
