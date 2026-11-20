import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Initiative, NeedsYouItem, Now, Project, Thread } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { decisionQueries, threadQueries } from "../../api/conversations.ts";
import { nowQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries } from "../../api/work.ts";
import {
  aDecision,
  DECISION_ID,
  FORMAT,
  INITIATIVE_ID,
  PLANNER,
  PLANNING_THREAD,
} from "../conversation/decision-card.fixtures.tsx";
import { DecisionDraftsProvider } from "../conversation/decision-drafts.tsx";
import { PROJECT_FILTER_STORAGE_KEY } from "../project-filter/project-filter-store.ts";
import { ToastProvider } from "../toasts.tsx";
import { signIn } from "../user.fixtures.ts";
import { NeedsYouFeed } from "./needs-you-feed.tsx";
import { useNeedsYou } from "./use-needs-you.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE = {
  id: INITIATIVE_ID,
  name: "Usage exports",
  projectIds: ["billing", "search"],
} as Initiative;

const PROJECTS = [
  {
    id: "billing",
    name: "Billing",
    icon: { light: null, dark: null },
    mark: { label: "BI", colour: "teal" },
  },
  {
    id: "search",
    name: "Search",
    icon: { light: null, dark: null },
    mark: { label: "SE", colour: "amber" },
  },
  {
    id: "admin",
    name: "Admin",
    icon: { light: null, dark: null },
    mark: { label: "AD", colour: "violet" },
  },
] as unknown as Project[];

const ON_THE_INITIATIVE: NeedsYouItem = {
  kind: "initiative-decision",
  decisionId: DECISION_ID,
  initiativeId: INITIATIVE_ID,
  threadId: PLANNING_THREAD,
  projectIds: ["billing", "search"],
  waitingSince: "2026-11-10T14:02:00.000Z",
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
});

function Feed(): ReactNode {
  const needsYou = useNeedsYou();
  return needsYou ? <NeedsYouFeed needsYou={needsYou} /> : null;
}

async function shown(needsYou: readonly NeedsYouItem[]): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  signIn(queryClient);
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(projectQueries.list().queryKey, PROJECTS);
  queryClient.setQueryData(nowQueries.now().queryKey, { needsYou } as unknown as Now);
  queryClient.setQueryData(initiativeQueries.one(INITIATIVE_ID).queryKey, INITIATIVE);
  queryClient.setQueryData(decisionQueries.open().queryKey, [
    aDecision({ threadId: PLANNING_THREAD, taskId: null, questions: [FORMAT] }),
  ]);
  queryClient.setQueryData(threadQueries.one(PLANNING_THREAD).queryKey, {
    id: PLANNING_THREAD,
    home: { kind: "initiative", initiativeId: INITIATIVE_ID },
    roleKey: "planner",
    state: "waiting",
    stageThread: false,
    stageContextLimits: null,
  } as Thread);
  const router = createRouter({
    routeTree: createRootRoute({ component: Feed }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <DecisionDraftsProvider>
            <RouterProvider router={router} />
          </DecisionDraftsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

describe("a Decision on no Task in Needs you", () => {
  it("is headed by the Initiative's name, linking to its Thread at the card, with its Projects", async () => {
    const page = await shown([ON_THE_INITIATIVE]);

    const item = page.querySelector("[aria-label='Decision on Usage exports']");
    expect(item).not.toBeNull();
    const title = item?.querySelector<HTMLAnchorElement>("a.needs-you-title");
    expect(title?.textContent).toBe("Usage exports");
    expect(title?.getAttribute("href")).toBe(
      `/work/initiatives/${INITIATIVE_ID}?initiativeThread=${PLANNING_THREAD}&decision=${DECISION_ID}`,
    );
    expect(
      [...(item?.querySelectorAll(".needs-you-heading .project-chip") ?? [])].map(
        (chip) => chip.textContent,
      ),
    ).toEqual(["BIBilling", "SESearch"]);
    expect(item?.querySelectorAll("[role='radiogroup']")).toHaveLength(1);
  });

  it("shows while the Project filter shows any of the Initiative's Projects", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["search"]));
    const page = await shown([ON_THE_INITIATIVE]);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    expect(page.querySelector("[aria-label='Decision on Usage exports']")).not.toBeNull();
  });

  it("is left out while the filter shows none of them, counted in other Projects", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["admin"]));
    const page = await shown([ON_THE_INITIATIVE]);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    expect(page.querySelector("[aria-label='Decision on Usage exports']")).toBeNull();
    expect(page.textContent).toContain("Nothing needs you in these Projects.");
  });
});
