import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { Idea } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { ideaQueries, initiativeQueries, taskQueries } from "../../api/work.ts";
import { WorkTabs } from "./work-tabs.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NEW_IDEA: Idea = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  title: "Usage exports",
  notes: "",
  projectId: null,
  state: "new",
  taskId: null,
  initiativeId: null,
  capturedBy: { kind: "user", user: null },
  capturedAt: "2026-11-07T10:00:00.000Z",
  droppedAt: null,
};

afterEach(() => {
  document.body.replaceChildren();
});

/** A list's page, standing for what the tab goes to. */
function page(name: string): () => ReactNode {
  return () => <p>{name}</p>;
}

/** The Task page's and the Initiative page's routes beside Work's, each showing the tabs. */
async function shownAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(projectQueries.list().queryKey, []);
  queryClient.setQueryData(taskQueries.list().queryKey, []);
  queryClient.setQueryData(ideaQueries.list().queryKey, [NEW_IDEA]);
  queryClient.setQueryData(initiativeQueries.list().queryKey, []);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/work", component: page("Board") }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/work/ideas",
        component: page("Ideas list"),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/work/initiatives",
        component: page("Initiatives board"),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/work/archived",
        component: page("Archive"),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/tasks/$taskId",
        component: () => <WorkTabs shown="tasks" />,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/work/initiatives/$initiativeId",
        component: () => <WorkTabs shown="initiatives" />,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  const tab = (name: string): HTMLButtonElement => {
    const found = [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((button) =>
      button.textContent?.startsWith(name),
    );
    if (!found) throw new Error(`No tab ${name}`);
    return found;
  };
  return { host, router, tab };
}

describe("WorkTabs", () => {
  it("shows Work's tabs on the Task page with Tasks chosen, and their counts", async () => {
    const { tab } = await shownAt("/tasks/42");

    expect(tab("Tasks").getAttribute("aria-selected")).toBe("true");
    expect(tab("Initiatives").getAttribute("aria-selected")).toBe("false");
    expect(tab("Ideas").textContent).toBe("Ideas1");
    // A count of 0 shows none.
    expect(tab("Tasks").textContent).toBe("Tasks");
  });

  it("shows them on the Initiative page with Initiatives chosen", async () => {
    const { tab } = await shownAt("/work/initiatives/7");

    expect(tab("Initiatives").getAttribute("aria-selected")).toBe("true");
    expect(tab("Tasks").getAttribute("aria-selected")).toBe("false");
  });

  it.each([
    ["Tasks", "/work", "Board"],
    ["Ideas", "/work/ideas", "Ideas list"],
    ["Initiatives", "/work/initiatives", "Initiatives board"],
    ["Archived", "/work/archived", "Archive"],
  ])("goes to the %s tab's list when pressed", async (name, path, shown) => {
    const { host, router, tab } = await shownAt("/tasks/42");

    await act(async () => {
      tab(name).click();
      await router.load();
    });

    expect(router.state.location.pathname).toBe(path);
    expect(host.textContent).toBe(shown);
  });
});
