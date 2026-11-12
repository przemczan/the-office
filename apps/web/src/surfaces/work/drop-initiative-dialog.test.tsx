import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Initiative, Task, TaskState } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";
import { DropInitiativeDialog } from "./drop-initiative-dialog.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INITIATIVE: Initiative = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  name: "Usage exports",
  outcome: "",
  state: "active",
  originIdeaId: null,
  projectIds: ["admin-panel"],
  createdBy: { kind: "user" },
  createdAt: "2026-11-10T09:00:00.000Z",
  endedAt: null,
  archivedAt: null,
  planningThreadId: null,
  planningAutoMode: false,
  pipelineId: null,
  shortName: null,
  branches: [],
};

function aTaskIn(state: TaskState, index: number): Task {
  return {
    id: `6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0${index}`,
    title: `Task ${index}`,
    state,
    initiativeId: INITIATIVE.id,
  } as Task;
}

function dialog(tasks: readonly Task[], initiative: Initiative = INITIATIVE): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <DropInitiativeDialog
            initiative={initiative}
            initiativeTasks={tasks}
            onClose={() => undefined}
          />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
}

function dropButton(): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((found) =>
    found.textContent.startsWith("Drop the Initiative"),
  );
}

describe("the Drop the Initiative window", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("names how many Tasks it drops and how many of them are started", () => {
    const states: TaskState[] = ["backlog", "ready", "in-progress", "paused", "done", "dropped"];

    dialog(states.map(aTaskIn));

    const text = document.body.textContent;
    expect(text).toContain("Drop Usage exports?");
    expect(text).toContain(
      "It drops its 4 Tasks not yet Done or Dropped, 2 of them started: their Stages stop.",
    );
    expect(text).not.toContain("branches");
    expect(dropButton()).toBeDefined();
  });

  it("says its branches are kept when it has them", () => {
    const branches = [
      {
        projectId: "admin-panel",
        branch: "initiative/usage-exports",
        madeAt: "2026-11-10T09:30:00.000Z",
      },
    ];

    dialog([aTaskIn("backlog", 1)], { ...INITIATIVE, branches });

    expect(document.body.textContent).toContain("Its branches are kept.");
  });

  it("shows a refusal in the window", async () => {
    const refusal = "A done Initiative can't be dropped.";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json({ statusCode: 422, message: refusal, reasons: [refusal] }, { status: 422 }),
        ),
      ),
    );
    dialog([]);

    await act(async () => {
      dropButton()?.click();
      await new Promise((resolve) => setTimeout(resolve));
    });

    expect(document.body.textContent).toContain("The Initiative can't be dropped");
    expect(document.body.textContent).toContain(refusal);
  });
});
