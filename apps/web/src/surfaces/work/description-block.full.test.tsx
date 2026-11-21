import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Idea, IssueLink, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { ideaQueries, taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { DescriptionBlock } from "./description-block.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BACKLOG_TASK: Task = {
  id: "00000000-0000-4000-8000-000000000011",
  title: "Sign-in keeps the page",
  description: "Keep the query string.",
  projectId: "firmware",
  priority: "normal",
  tags: [],
  state: "backlog",
  plan: "",
  pausedBy: null,
  engineStandIns: [],
  resumesAt: null,
  autoMode: false,
  initiativePlanningThreadId: null,
  markedPlanned: false,
  hasPlanningThread: false,
  planConfirmed: false,
  filesToChange: [],
  estimatedTokens: null,
  definitionOfDone: [],
  definitionOfDoneConfirmed: false,
  commitMessage: "Commit message",
  commitMessageWritten: false,
  commitMessagePublishedAt: null,
  pipelineId: "full",
  proposedPipeline: null,
  blockedBy: [],
  originIdeaId: null,
  initiativeId: null,
  madeFor: null,
  resolvesTaskId: null,
  projectMoves: [],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-10-28T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
  pullRequestEnd: null,
  kind: "feature",
  causedBy: null,
  foundInVersion: null,
  foundWhileWorkingOn: null,
  dropReason: null,
};

const IDEA: Idea = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4e",
  title: "Usage exports",
  notes: "",
  projectId: null,
  state: "shaped",
  taskId: BACKLOG_TASK.id,
  initiativeId: null,
  capturedBy: { kind: "user", user: null },
  capturedAt: "2026-11-07T10:00:00.000Z",
  droppedAt: null,
};

/** The Task's Description block, in a router of its own for its links. */
async function descriptionOf(
  task: Task,
  others: readonly Task[] = [],
  issue: IssueLink | null = null,
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(taskQueries.list().queryKey, [task, ...others]);
  queryClient.setQueryData(taskQueries.archived().queryKey, []);
  queryClient.setQueryData(projectQueries.list().queryKey, []);
  queryClient.setQueryData(ideaQueries.one(IDEA.id).queryKey, IDEA);
  queryClient.setQueryData(projectQueries.issueLink(task.id).queryKey, issue);
  const rootRoute = createRootRoute({ component: () => <DescriptionBlock task={task} /> });
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

function sectionOf(page: HTMLElement, name: string): HTMLElement | null {
  return page.querySelector(`section[aria-label="${name}"]`);
}

describe("the Description block", () => {
  afterEach(() => document.body.replaceChildren());

  it("starts open on a started Task", async () => {
    const page = await descriptionOf({
      ...BACKLOG_TASK,
      id: "00000000-0000-4000-8000-000000000012",
      state: "in-progress",
    });

    expect(page.querySelector<HTMLElement>(".record-fold-body")?.hidden).toBe(false);
    expect(page.textContent).toContain("Keep the query string.");
  });

  it("shows its Dependencies with Add before the Task starts", async () => {
    const page = await descriptionOf(BACKLOG_TASK);
    const dependencies = sectionOf(page, "Dependencies");
    const add = [...(dependencies?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent.startsWith("Add"),
    );

    expect(dependencies?.closest('section[aria-label="Description"]')).not.toBeNull();
    expect(dependencies?.textContent).toContain("It waits for no Task, and none waits for it.");

    act(() => add?.click());

    expect(document.body.textContent).toContain("What must be Done first?");
  });

  it("shows its Origin only when the Task has one", async () => {
    const page = await descriptionOf(BACKLOG_TASK);

    expect(sectionOf(page, "Origin")).toBeNull();

    const shaped = await descriptionOf({
      ...BACKLOG_TASK,
      id: "00000000-0000-4000-8000-000000000013",
      originIdeaId: IDEA.id,
    });

    expect(sectionOf(shaped, "Origin")?.textContent).toContain("Usage exports");
  });

  it("links a Task and its Conflict resolution Tasks both ways, the newest first", async () => {
    const original = { ...BACKLOG_TASK, state: "waiting-on-you" as const };
    const first: Task = {
      ...BACKLOG_TASK,
      id: "00000000-0000-4000-8000-000000000021",
      title: "Resolve conflicts: Sign-in keeps the page",
      state: "done",
      madeFor: "resolve-conflicts",
      resolvesTaskId: original.id,
      createdAt: "2026-11-12T10:00:00.000Z",
    };
    const second: Task = {
      ...first,
      id: "00000000-0000-4000-8000-000000000022",
      title: "Resolve conflicts again",
      state: "in-progress",
      createdAt: "2026-11-13T10:00:00.000Z",
    };

    const page = await descriptionOf(original, [first, second]);
    const section = sectionOf(page, "Conflict resolution");
    expect(section?.textContent).toContain(
      "Conflicts resolved by: Resolve conflicts again (In progress), Resolve conflicts: Sign-in keeps the page (Done)",
    );
    expect(section?.querySelector("a")?.getAttribute("href")).toBe(`/tasks/${second.id}`);
    expect(section?.textContent).not.toContain("Resolves the conflicts of");
    document.body.replaceChildren();

    const resolving = await descriptionOf(second, [original, first]);
    const its = sectionOf(resolving, "Conflict resolution");
    expect(its?.textContent).toContain(
      "Resolves the conflicts of: Sign-in keeps the page (Waiting on you)",
    );
    expect(its?.querySelector("a")?.getAttribute("href")).toBe(`/tasks/${original.id}`);
    expect(its?.textContent).not.toContain("Conflicts resolved by");
  });

  it("shows no Conflict resolution section on a Task with none", async () => {
    const page = await descriptionOf(BACKLOG_TASK);

    expect(sectionOf(page, "Conflict resolution")).toBeNull();
  });

  it("shows a Bug's details only on a Bug, keeping them while it is another Kind", async () => {
    const details = { foundInVersion: "v1.14.2" };
    const feature = await descriptionOf({ ...BACKLOG_TASK, ...details });
    expect(sectionOf(feature, "Bug")).toBeNull();
    document.body.replaceChildren();

    const bug = await descriptionOf({ ...BACKLOG_TASK, ...details, kind: "bug" });
    const section = sectionOf(bug, "Bug");

    expect(section?.textContent).toContain("Found in versionv1.14.2");
    expect(section?.textContent).toContain("Not found by an Agent");
    expect(section?.textContent).toContain("Add what caused it");
  });

  it("shows a Done Bug's details read-only, its empty rows hidden", async () => {
    const page = await descriptionOf({
      ...BACKLOG_TASK,
      kind: "bug",
      state: "done",
      foundInVersion: "nightly",
    });
    const section = sectionOf(page, "Bug");

    expect(section?.querySelectorAll("button")).toHaveLength(0);
    expect(section?.textContent).not.toContain("Caused by");
    expect(section?.textContent).toContain("nightly");
  });

  it("lists the Bugs its change caused and the Tasks dropped as its duplicates", async () => {
    const caused = {
      ...BACKLOG_TASK,
      id: "00000000-0000-4000-8000-000000000021",
      title: "Login fails",
      kind: "bug" as const,
      causedBy: BACKLOG_TASK.id,
    };
    const duplicate = {
      ...BACKLOG_TASK,
      id: "00000000-0000-4000-8000-000000000022",
      title: "Sign-in loses the page",
      state: "dropped" as const,
      dropReason: { kind: "duplicate" as const, taskId: BACKLOG_TASK.id },
    };
    const page = await descriptionOf(BACKLOG_TASK, [caused, duplicate]);

    expect(sectionOf(page, "Caused bugs")?.textContent).toContain("Login fails");
    expect(sectionOf(page, "Duplicates")?.textContent).toContain("Sign-in loses the page");
  });

  it("shows the GitHub issue it was made from, closed there before it started", async () => {
    const page = await descriptionOf(BACKLOG_TASK, [], {
      number: 7,
      title: "Login fails after a password reset",
      url: "https://github.com/acme/office/issues/7",
      author: { login: "octocat", url: "https://github.com/octocat" },
      importedAt: "2026-11-07T10:00:00.000Z",
      importedBy: { kind: "office" },
      closedOnHostAt: "2026-11-08T10:00:00.000Z",
      writeBackProblem: null,
    });
    const section = sectionOf(page, "GitHub issue");

    expect(section?.querySelector("a")?.textContent).toBe("#7 Login fails after a password reset");
    expect(section?.textContent).toContain("opened byoctocat");
    expect(section?.textContent).toContain("imported by The Office");
    expect(section?.textContent).toContain("The issue was closed before this Task started.");
  });
});
