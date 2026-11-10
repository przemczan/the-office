import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueuedTask, Task, TaskStages } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineQueries } from "../../api/pipelines.ts";
import { taskQueries } from "../../api/work.ts";
import { DefinitionOfDoneBlock, PlanBlock } from "./planning-parts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RUNNING_TASK: Task = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Sign-in keeps the page",
  description: "",
  projectId: "firmware",
  priority: "normal",
  tags: [],
  state: "in-progress",
  plan: "",
  pausedByAlarm: false,
  autoMode: false,
  planConfirmed: true,
  filesToChange: [],
  estimatedTokens: null,
  definitionOfDone: ["Sign-in returns.", "The query string stays.", "The tests pass."],
  definitionOfDoneConfirmed: true,
  pipelineId: "full",
  proposedPipeline: null,
  blockedBy: [],
  originIdeaId: null,
  initiativeId: null,
  projectMoves: [],
  createdBy: { kind: "user" },
  createdAt: "2026-10-28T10:00:00.000Z",
  archivedAt: null,
};

function stagesWith(definitionOfDoneMet: readonly number[]): TaskStages {
  return {
    stages: [],
    definitionOfDoneMet: [...definitionOfDoneMet],
    editedForTask: false,
    lockedStages: 0,
    testResults: [],
  };
}

describe("the Definition of Done on a started Task", () => {
  it("reads Reported met from the service, so a later run lowers the count", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const { queryKey } = pipelineQueries.taskStages(RUNNING_TASK.id);
    queryClient.setQueryData(queryKey, stagesWith([1, 2, 3]));
    const page = document.createElement("div");
    act(() =>
      createRoot(page).render(
        <QueryClientProvider client={queryClient}>
          <DefinitionOfDoneBlock task={RUNNING_TASK} planner="Jan" />
        </QueryClientProvider>,
      ),
    );
    const marked = (): number => page.querySelectorAll('[aria-label="Reported met"]').length;

    expect(page.textContent).toContain("3 of 3 Reported met");
    expect(page.textContent).toContain("All Reported met");
    expect(marked()).toBe(3);

    // The query notifies its readers on the next tick.
    await act(async () => {
      queryClient.setQueryData(queryKey, stagesWith([2]));
      await new Promise((resolve) => setTimeout(resolve));
    });

    expect(page.textContent).toContain("1 of 3 Reported met");
    expect(page.textContent).toContain("1 / 3");
    expect(page.textContent).not.toContain("All Reported met");
    expect(marked()).toBe(1);
  });
});

const WRITTEN_TASK: Task = {
  ...RUNNING_TASK,
  state: "backlog",
  plan: "Keep the path.",
  planConfirmed: false,
};

/** The Plan's block on a page of its own; `queue` is what the queue holds. */
function planPage(task: Task, queue: readonly QueuedTask[] = []): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(taskQueries.queue().queryKey, [...queue]);
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <PlanBlock task={task} planner="Jan" />
      </QueryClientProvider>,
    ),
  );
  return page;
}

/** By the words it starts with: a Button also holds its spinner's styles. */
function button(page: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find((found) => found.textContent.startsWith(name));
}

function click(element: HTMLElement | undefined): void {
  act(() => element?.click());
}

describe("the Plan's block", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("reads Not confirmed with Confirm beside it, whoever wrote the Plan", () => {
    const page = planPage(WRITTEN_TASK);

    expect(page.textContent).toContain("Not confirmed");
    expect(page.textContent).not.toContain("Proposed");
    expect(button(page, "Confirm")).toBeDefined();
    expect(button(planPage({ ...WRITTEN_TASK, state: "planning" }), "Confirm")).toBeDefined();
  });

  it("offers neither Confirm nor Edit in Shaping, and says what it waits for", () => {
    const written = planPage({ ...WRITTEN_TASK, state: "shaping" });
    const unwritten = planPage({ ...WRITTEN_TASK, state: "shaping", plan: "" });

    expect(button(written, "Confirm")).toBeUndefined();
    expect(button(written, "Edit")).toBeUndefined();
    expect(unwritten.textContent).toContain("It is written once the Initiative is confirmed.");
  });

  it("offers no Confirm once the Plan is confirmed", () => {
    const page = planPage({ ...WRITTEN_TASK, planConfirmed: true });

    expect(page.textContent).toContain("Confirmed");
    expect(button(page, "Confirm")).toBeUndefined();
  });

  it("saves with Save, sending the words to the Plan and not to Confirm", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...WRITTEN_TASK, plan: "Mine." })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = planPage(WRITTEN_TASK);

    click(button(page, "Edit"));
    expect(page.textContent).not.toContain("Save and confirm");
    await act(async () => {
      page.querySelector("form")?.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve));
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/tasks/${WRITTEN_TASK.id}/plan`);
    expect(request?.method).toBe("PUT");
    expect(fetched.mock.calls.map(([called]) => called)).not.toContain(
      `/api/tasks/${WRITTEN_TASK.id}/plan/confirm`,
    );
  });

  it("confirms the Plan as it reads, with nothing to send", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...WRITTEN_TASK, planConfirmed: true })),
    );
    vi.stubGlobal("fetch", fetched);
    const page = planPage(WRITTEN_TASK);

    await act(async () => {
      button(page, "Confirm")?.click();
      await new Promise((resolve) => setTimeout(resolve));
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/tasks/${WRITTEN_TASK.id}/plan/confirm`);
    expect(request?.method).toBe("POST");
  });

  it("says beside Save what a change does to a Ready Task, and to a queued one", () => {
    const ready: Task = { ...WRITTEN_TASK, state: "ready", planConfirmed: true };
    const queued: QueuedTask = {
      taskId: ready.id,
      place: 1,
      queuedAt: "2026-10-28T10:00:00.000Z",
      reasons: [],
      behind: [],
    };

    const page = planPage(ready);
    click(button(page, "Edit"));
    const queuedPage = planPage(ready, [queued]);
    click(button(queuedPage, "Edit"));
    const backlogPage = planPage(WRITTEN_TASK);
    click(button(backlogPage, "Edit"));

    expect(page.querySelector(".task-part-note")?.textContent).toBe(
      "Saving a change moves this Task to Backlog, to confirm and mark Ready again.",
    );
    expect(queuedPage.querySelector(".task-part-note")?.textContent).toBe(
      "Saving a change takes this Task out of the queue and moves it to Backlog, to confirm and mark Ready again.",
    );
    expect(backlogPage.querySelector(".task-part-note")).toBeNull();
  });
});
