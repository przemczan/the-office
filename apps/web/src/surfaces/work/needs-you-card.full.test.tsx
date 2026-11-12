import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Decision, Readiness, Role, Task, TaskStages, Thread } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decisionQueries, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { taskQueries } from "../../api/work.ts";
import { clockOf } from "../../shell/time.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { ConversationDrawerProvider } from "./conversation-drawer.tsx";
import { NeedsYouCard } from "./needs-you-card.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE_ID = "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const PLANNING_THREAD = "8a7b6c5d-4e3f-4a1b-9c0d-1e2f3a4b5c6d";

const TASK = {
  id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Export usage as CSV",
  state: "planning",
  plan: "",
  definitionOfDone: [],
  proposedPipeline: null,
  initiativeId: INITIATIVE_ID,
  initiativePlanningThreadId: PLANNING_THREAD,
} as unknown as Task;

function aDecision(id: string, question: string): Decision {
  return {
    id,
    threadId: PLANNING_THREAD,
    taskId: TASK.id,
    roleKey: "planner",
    question,
    context: "",
    options: ["CSV", "JSON"],
    recommendation: { option: 0, reason: "Spreadsheets open it." },
    attachmentIds: [],
    askedAt: "2026-11-10T14:02:00.000Z",
    putTo: null,
    passedOn: [],
    answer: null,
    answeredAt: null,
    answeredBy: null,
    atUsersRequest: null,
  };
}

const DECISIONS = [
  aDecision("1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", "Which format?"),
  aDecision("2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f", "Which columns?"),
];

const PLANNING_THREAD_RECORD = {
  id: PLANNING_THREAD,
  home: { kind: "initiative", initiativeId: INITIATIVE_ID },
  roleKey: "planner",
  state: "answering",
  stageThread: false,
} as unknown as Thread;

const READINESS: Readiness = {
  lines: [{ part: "decisions", label: "No Decision open", met: false, problems: [] }],
};

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;

async function rendered(): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(decisionQueries.unanswered(TASK.id).queryKey, DECISIONS);
  queryClient.setQueryData(pipelineQueries.taskStages(TASK.id).queryKey, {
    stages: [],
  } as unknown as TaskStages);
  queryClient.setQueryData(threadQueries.one(PLANNING_THREAD).queryKey, PLANNING_THREAD_RECORD);
  queryClient.setQueryData(taskQueries.readiness(TASK.id).queryKey, READINESS);
  queryClient.setQueryData(pipelineQueries.list().queryKey, []);
  const rootRoute = createRootRoute();
  const taskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "tasks/$taskId",
    component: () => (
      <ConversationDrawerProvider>
        <NeedsYouCard task={TASK} />
      </ConversationDrawerProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([taskRoute]),
    history: createMemoryHistory({ initialEntries: [`/tasks/${TASK.id}`] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

describe("a Task's Decisions opened in its Initiative's planning Thread", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("are listed in Needs you, each linking to the Initiative's planning Thread", async () => {
    const page = await rendered();

    const cards = page.querySelectorAll(".decision-card");
    expect(cards).toHaveLength(2);
    const place = cards[0]?.querySelector("a.needs-you-place");
    expect(place?.textContent).toBe(
      `in the Initiative's planning Thread · ${clockOf(DECISIONS[0]?.askedAt ?? "")}`,
    );
    expect(place?.getAttribute("href")).toBe(
      `/work/initiatives/${INITIATIVE_ID}?initiativeThread=${PLANNING_THREAD}`,
    );
  });

  it("stay answerable while the Planner works, saying when the answer reaches them", async () => {
    const page = await rendered();

    const options = [...page.querySelectorAll<HTMLButtonElement>(".decision-options button")];
    expect(options).toHaveLength(4);
    expect(options.every((option) => !option.disabled)).toBe(true);
    expect(page.textContent).toContain("Reaches Angela when this turn ends.");
    expect(page.textContent).not.toContain("is still answering");
  });

  it("are counted by Before Ready", async () => {
    const page = await rendered();

    expect(page.querySelector(".before-ready-line")?.textContent).toContain("2 open, in Needs you");
  });
});
