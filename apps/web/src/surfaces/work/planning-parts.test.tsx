import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task, TaskStages } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { pipelineQueries } from "../../api/pipelines.ts";
import { DefinitionOfDoneBlock } from "./planning-parts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RUNNING_TASK: Task = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Sign-in keeps the page",
  projectId: "firmware",
  priority: "normal",
  tags: [],
  state: "in-progress",
  plan: "",
  pausedByAlarm: false,
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
  createdBy: { kind: "user" },
  createdAt: "2026-10-28T10:00:00.000Z",
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
