import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Initiative, Project, ProjectBranches, Task } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries } from "../../api/work.ts";
import { useBrowseFilesAction, useBrowseInitiativeFilesActions } from "./browse-files.tsx";
import { RecordActionButton } from "./record-actions.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INITIATIVE_ID = "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

const TASK = { id: TASK_ID, projectId: "shop", madeFor: null, initiativeId: null } as Task;
const PUBLISHING_TASK = {
  ...TASK,
  madeFor: "publishing",
  initiativeId: INITIATIVE_ID,
} as Task;
const INITIATIVE = {
  id: INITIATIVE_ID,
  shortName: "exports",
  projectIds: ["shop"],
} as Initiative;
const PROJECTS = [
  { id: "shop", name: "Shop" },
  { id: "admin", name: "Admin panel" },
] as Project[];

function branchesWith(...names: string[]): ProjectBranches {
  return {
    baseBranch: { name: "main", kind: "local", commit: "a".repeat(40) },
    branches: names.map((name) => ({ name, kind: "local", commit: "b".repeat(40) })),
    fetchProblem: null,
  };
}

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json({}, { status: 404 })));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function rendered(
  branches: Readonly<Record<string, ProjectBranches>>,
  Actions: () => ReactNode,
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const [projectId, known] of Object.entries(branches)) {
    queryClient.setQueryData(projectQueries.branches(projectId, { fetch: false }).queryKey, known);
  }
  queryClient.setQueryData(projectQueries.list().queryKey, PROJECTS);
  queryClient.setQueryData(initiativeQueries.one(INITIATIVE_ID).queryKey, INITIATIVE);
  const router = createRouter({
    routeTree: createRootRoute({ component: Actions }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

function TaskActions({ task }: { readonly task: Task }): ReactNode {
  const action = useBrowseFilesAction(task);
  return action && <RecordActionButton action={action} />;
}

function InitiativeButtons({ initiative }: { readonly initiative: Initiative }): ReactNode {
  return useBrowseInitiativeFilesActions(initiative).map((action) => (
    <RecordActionButton key={action.key} action={action} />
  ));
}

/** Each link's words, with the Project and the branch it opens the Files tab on. */
function links(page: HTMLElement): [string, string, string | null][] {
  return [...page.querySelectorAll("a")].map((link) => {
    const url = new URL(link.getAttribute("href") ?? "", "http://office.test");
    return [link.textContent, url.pathname, url.searchParams.get("branch")];
  });
}

describe("Browse files on a Task", () => {
  it("opens the Project's Files on the Task's branch, once it is there", async () => {
    const page = await rendered({ shop: branchesWith(`office/${TASK_ID}`) }, () => (
      <TaskActions task={TASK} />
    ));

    expect(links(page)).toEqual([["Browse files", "/projects/shop/files", `office/${TASK_ID}`]]);
  });

  it("isn't offered while the Task's branch isn't there", async () => {
    const page = await rendered({ shop: branchesWith("office/another") }, () => (
      <TaskActions task={TASK} />
    ));

    expect(links(page)).toEqual([]);
  });

  it("opens a Publishing Task's Initiative's branch", async () => {
    const page = await rendered({ shop: branchesWith("initiative/exports") }, () => (
      <TaskActions task={PUBLISHING_TASK} />
    ));

    expect(links(page)).toEqual([["Browse files", "/projects/shop/files", "initiative/exports"]]);
  });
});

describe("Browse files on an Initiative", () => {
  it("opens the Initiative's branch in its one Project", async () => {
    const page = await rendered({ shop: branchesWith("initiative/exports") }, () => (
      <InitiativeButtons initiative={INITIATIVE} />
    ));

    expect(links(page)).toEqual([["Browse files", "/projects/shop/files", "initiative/exports"]]);
  });

  it("names the Project in each, only where the branch is there", async () => {
    const page = await rendered(
      {
        shop: branchesWith("initiative/exports"),
        admin: branchesWith("initiative/other"),
      },
      () => <InitiativeButtons initiative={{ ...INITIATIVE, projectIds: ["shop", "admin"] }} />,
    );

    expect(links(page)).toEqual([
      ["Browse files in Shop", "/projects/shop/files", "initiative/exports"],
    ]);
  });

  it("isn't offered without a Short name", async () => {
    const page = await rendered({ shop: branchesWith("initiative/exports") }, () => (
      <InitiativeButtons initiative={{ ...INITIATIVE, shortName: null }} />
    ));

    expect(links(page)).toEqual([]);
  });
});
