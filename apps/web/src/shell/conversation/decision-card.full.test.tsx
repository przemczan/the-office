import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Decision, Role, Task, Thread } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../toasts.tsx";
import { DecisionInThread } from "./decision-card.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE_ID = "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const PLANNING_THREAD = "8a7b6c5d-4e3f-4a1b-9c0d-1e2f3a4b5c6d";
const TASK_THREAD = "9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e";

const TASK = { id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c", title: "Export usage as CSV" } as Task;

function aDecision(threadId: string): Decision {
  return {
    id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
    threadId,
    taskId: TASK.id,
    roleKey: "planner",
    question: "Which format?",
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
  };
}

function aThread(id: string, home: Thread["home"]): Thread {
  return { id, home, roleKey: "planner", state: "answering", stageThread: false } as Thread;
}

const PLANNER = { key: "planner", letGoAt: null, card: { name: "Angela" } } as unknown as Role;

async function rendered(decision: Decision): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(taskQueries.one(TASK.id).queryKey, TASK);
  queryClient.setQueryData(
    threadQueries.one(PLANNING_THREAD).queryKey,
    aThread(PLANNING_THREAD, { kind: "initiative", initiativeId: INITIATIVE_ID }),
  );
  queryClient.setQueryData(
    threadQueries.one(TASK_THREAD).queryKey,
    aThread(TASK_THREAD, { kind: "task", taskId: TASK.id }),
  );
  const rootRoute = createRootRoute({
    component: () => <DecisionInThread decision={decision} personName="Angela" />,
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
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

describe("a Decision in its Thread", () => {
  afterEach(() => document.body.replaceChildren());

  it("names its Task in an Initiative's planning Thread, leading to its card there", async () => {
    const page = await rendered(aDecision(PLANNING_THREAD));

    const onTask = page.querySelector(".decision-on-task");
    expect(onTask?.textContent).toBe(`On ${TASK.title}`);
    expect(onTask?.querySelector("a")?.getAttribute("href")).toBe(`/tasks/${TASK.id}`);
    const toCard = [...page.querySelectorAll("a")].find(
      (link) => link.textContent === "Answer it in Needs you",
    );
    expect(toCard?.getAttribute("href")).toBe(
      `/tasks/${TASK.id}?decision=1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e`,
    );
  });

  it("names no Task in a Thread on the Task", async () => {
    const page = await rendered(aDecision(TASK_THREAD));

    expect(page.querySelector(".decision-on-task")).toBeNull();
  });
});
