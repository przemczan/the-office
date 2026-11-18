import type { EngineStandIn, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EngineStandInsMark } from "./task-page.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the tooltip, placed by its size, never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const FOR_WORK: EngineStandIn = {
  engineId: "work",
  engineName: "Work",
  standInId: "personal",
  standInName: "Personal",
  reason: "Work's 5-hour window would be passed; Personal had room.",
  short: "Work's window is full",
};

function aTask(fields: Partial<Task>): Task {
  return {
    id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
    title: "Remember the sort",
    description: "",
    projectId: "admin-panel",
    priority: "normal",
    tags: [],
    state: "in-progress",
    plan: "",
    pausedBy: null,
    engineStandIns: [],
    resumesAt: null,
    autoMode: false,
    initiativePlanningThreadId: null,
    markedPlanned: false,
    hasPlanningThread: false,
    planConfirmed: true,
    filesToChange: [],
    estimatedTokens: null,
    definitionOfDone: [],
    definitionOfDoneConfirmed: true,
    commitMessage: "Commit message",
    commitMessageWritten: false,
    commitMessagePublishedAt: null,
    pipelineId: "full",
    proposedPipeline: null,
    blockedBy: [],
    originIdeaId: null,
    initiativeId: null,
    madeFor: null,
    projectMoves: [],
    createdBy: { kind: "user", user: null },
    createdAt: "2026-11-11T10:00:00.000Z",
    archivedAt: null,
    endedAt: null,
    ...fields,
  };
}

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

function show(task: Task): HTMLElement {
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  act(() => root.render(<EngineStandInsMark task={task} />));
  return page;
}

describe("EngineStandInsMark", () => {
  it("names the Stand-in Engine a started Task works on, with why on hover", () => {
    const page = show(aTask({ engineStandIns: [FOR_WORK] }));
    expect(page.textContent).toBe("On a Stand-in Engine: Personal for Work");
    act(() => {
      page
        .querySelector(".tooltip-trigger")
        ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(FOR_WORK.reason);
  });

  it("shows nothing for a started Task on the cascade's engines", () => {
    expect(show(aTask({ engineStandIns: [] })).textContent).toBe("");
  });

  it("shows nothing once the Task is no longer started", () => {
    expect(show(aTask({ state: "done", engineStandIns: [FOR_WORK] })).textContent).toBe("");
  });
});
