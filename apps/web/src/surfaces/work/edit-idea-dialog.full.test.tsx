import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Idea, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionQueries } from "../../api/conversations.ts";
import { projectQueries } from "../../api/projects.ts";
import { type editIdea, ideaQueries, initiativeQueries, taskQueries } from "../../api/work.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { EditIdeaDialog } from "./edit-idea-dialog.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ editIdea: vi.fn<typeof editIdea>() }));
vi.mock("../../api/work.ts", async (original) => ({
  ...(await original<typeof import("../../api/work.ts")>()),
  editIdea: api.editIdea,
}));

const MENTIONED_TASK: Task = {
  id: "00000000-0000-4000-8000-000000000002",
  title: "Sign-in keeps the page",
  description: "",
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
  engineOverride: null,
  initiativeEngineOverride: null,
  peopleEngineSettings: [],
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

const IDEA = {
  id: "0b6c1d2e-3f4a-4b5c-8d6e-7f8a9b0c1d2e",
  title: "Show battery level",
  notes: "",
  projectId: null,
} as Idea;

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  api.editIdea.mockReset();
});

function open(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(projectQueries.list().queryKey, []);
  queryClient.setQueryData(taskQueries.list().queryKey, [MENTIONED_TASK]);
  queryClient.setQueryData(taskQueries.archived().queryKey, []);
  queryClient.setQueryData(initiativeQueries.list().queryKey, []);
  queryClient.setQueryData(decisionQueries.open().queryKey, []);
  queryClient.setQueryData(ideaQueries.list().queryKey, []);
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <EditIdeaDialog idea={IDEA} onClose={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  unmount = () => {
    act(() => root.unmount());
    page.remove();
  };
}

function notes(): HTMLTextAreaElement {
  const found = [...document.querySelectorAll("textarea")][0];
  if (!found) throw new Error("The dialog has no notes field.");
  return found;
}

function type(text: string): void {
  const box = notes();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(box, text);
    box.setSelectionRange(text.length, text.length);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange"));
  });
}

describe("an Idea's notes", () => {
  it("offer the records matching what follows @, and are saved with the one picked as a link", async () => {
    api.editIdea.mockResolvedValue(IDEA);
    open();

    type("Like @sign");
    expect(
      [...document.querySelectorAll('[role="option"]')].map(({ textContent }) => textContent),
    ).toEqual(["Sign-in keeps the pageTask"]);

    act(() => {
      notes().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(notes().value).toBe("Like @Sign-in keeps the page ");

    type("Like @Sign-in keeps the page here.");
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });

    expect(api.editIdea).toHaveBeenCalledWith(
      IDEA.id,
      expect.objectContaining({
        notes: `Like [@Sign-in keeps the page](/tasks/${MENTIONED_TASK.id}) here.`,
      }),
    );
  });
});
