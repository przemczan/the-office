import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ConversationTab, Role, Task, Thread } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadQueries } from "../../api/conversations.ts";
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
async function rendered(
  tab: ConversationTab = PLANNERS_TAB,
  arrived: (queryClient: QueryClient) => void = () => undefined,
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  arrived(queryClient);
  const rootRoute = createRootRoute({
    component: () => (
      <TabLog
        task={TASK}
        tab={tab}
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

const DEVELOPERS_THREAD = {
  id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  roleKey: "developer",
  title: null,
  state: "waiting",
  stageThread: false,
  stageContextLimits: null,
} as unknown as Thread;

const DEVELOPERS_TAB: ConversationTab = {
  roleKey: "developer",
  threadId: DEVELOPERS_THREAD.id,
  stageRunning: false,
  consultations: [],
  planningThreadElsewhere: null,
};

/** Each Thread read fails with its problem when given one, and is otherwise still on its way. */
function stubThreadReads(problem?: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      problem === undefined
        ? new Promise<Response>(() => undefined)
        : Response.json({ message: problem }, { status: 500 }),
    ),
  );
}

describe("a person's tab while their Thread loads", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("shows the turns loader, not an empty Thread, until the Thread arrives", async () => {
    stubThreadReads();

    const page = await rendered(DEVELOPERS_TAB);

    const loader = page.querySelector('[role="status"].block-loader.turns');
    expect(loader?.querySelector(".visually-hidden")?.textContent).toBe("Loading the Thread…");
  });

  it("keeps the loader until the Thread's messages arrive", async () => {
    stubThreadReads();

    const page = await rendered(DEVELOPERS_TAB, (queryClient) =>
      queryClient.setQueryData(threadQueries.one(DEVELOPERS_THREAD.id).queryKey, DEVELOPERS_THREAD),
    );

    expect(page.querySelector('[role="status"].block-loader.turns')).not.toBeNull();
  });

  it("shows the log once the messages arrive", async () => {
    stubThreadReads();

    const page = await rendered(DEVELOPERS_TAB, (queryClient) => {
      queryClient.setQueryData(threadQueries.one(DEVELOPERS_THREAD.id).queryKey, DEVELOPERS_THREAD);
      queryClient.setQueryData(threadQueries.messages(DEVELOPERS_THREAD.id).queryKey, []);
    });

    expect(page.querySelector(".block-loader")).toBeNull();
  });

  it("shows the problem of a read that failed instead of the loader", async () => {
    stubThreadReads("The Thread can't be read");

    const page = await rendered(DEVELOPERS_TAB);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(page.querySelector(".block-loader")).toBeNull();
    expect(page.querySelector('[role="status"]')?.textContent).toBe("The Thread can't be read");
  });
});

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
