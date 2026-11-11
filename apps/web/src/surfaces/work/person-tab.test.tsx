import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ConversationTab, Role, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { TabLog } from "./person-tab.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE_ID = "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const PLANNING_THREAD = "8a7b6c5d-4e3f-4a1b-9c0d-1e2f3a4b5c6d";

const TASK = {
  id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Export usage as CSV",
  description: "",
  state: "planning",
  autoMode: true,
  initiativeId: INITIATIVE_ID,
  initiativePlanningThreadId: PLANNING_THREAD,
  markedPlanned: false,
  hasPlanningThread: false,
} as Task;

const PLANNERS_TAB: ConversationTab = {
  roleKey: "planner",
  threadId: null,
  stageRunning: false,
  consultations: [],
  planningThreadElsewhere: { initiativeId: INITIATIVE_ID, threadId: PLANNING_THREAD },
};

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;

/** Renders the tab in a router of its own, so its link has somewhere to point. */
async function rendered(): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  const rootRoute = createRootRoute({
    component: () => (
      <TabLog
        task={TASK}
        tab={PLANNERS_TAB}
        personName="Angela"
        emptyWords=""
        readOnlyReason={undefined}
        onShown={() => undefined}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
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

describe("the Planner's tab of a Task planned in its Initiative's planning Thread", () => {
  afterEach(() => document.body.replaceChildren());

  it("says so and links to that Thread", async () => {
    const page = await rendered();

    expect(page.textContent).toContain(
      "Angela is planning this Task in the Initiative's planning Thread.",
    );
    const link = page.querySelector("a");
    expect(link?.textContent).toBe("Open the planning Thread");
    expect(link?.getAttribute("href")).toBe(
      `/work/initiatives/${INITIATIVE_ID}?initiativeThread=${PLANNING_THREAD}`,
    );
  });
});
