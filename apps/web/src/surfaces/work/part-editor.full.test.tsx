import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionQueries } from "../../api/conversations.ts";
import { ideaQueries, initiativeQueries, taskQueries } from "../../api/work.ts";
import { PartEditor } from "./part-editor.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  initiativeId: null,
  madeFor: null,
  projectMoves: [],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-10-28T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
};

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function editorWith(onSave: (text: string) => void): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(taskQueries.list().queryKey, [MENTIONED_TASK]);
  queryClient.setQueryData(initiativeQueries.list().queryKey, []);
  queryClient.setQueryData(decisionQueries.open().queryKey, []);
  queryClient.setQueryData(ideaQueries.list().queryKey, []);
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <PartEditor
          label="Description"
          hint="What you want."
          initial=""
          mentions
          saving={false}
          onSave={onSave}
          onCancel={() => undefined}
        />
      </QueryClientProvider>,
    ),
  );
  unmount = () => {
    act(() => root.unmount());
    page.remove();
  };
  return page;
}

function field(page: HTMLElement): HTMLTextAreaElement {
  const found = page.querySelector("textarea");
  if (!found) throw new Error("The editor has no field.");
  return found;
}

function type(page: HTMLElement, text: string): void {
  const box = field(page);
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(box, text);
    box.setSelectionRange(text.length, text.length);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    // A browser tells the page the caret moved; without it React's next `select` reads it as new.
    document.dispatchEvent(new Event("selectionchange"));
  });
}

function press(page: HTMLElement, key: string): void {
  act(() => {
    field(page).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function options(page: HTMLElement): string[] {
  return [...page.querySelectorAll('[role="option"]')].map(({ textContent }) => textContent);
}

describe("a part editor with mentions", () => {
  it("offers the records matching what follows @, and saves the one picked as a link", () => {
    const onSave = vi.fn<(text: string) => void>();
    const page = editorWith(onSave);

    type(page, "Like @sign");
    expect(options(page)).toEqual(["Sign-in keeps the pageTask"]);

    press(page, "Enter");
    expect(field(page).value).toBe("Like @Sign-in keeps the page ");
    expect(options(page)).toEqual([]);

    type(page, "Like @Sign-in keeps the page here.");
    act(() => page.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());

    expect(onSave).toHaveBeenCalledWith(
      `Like [@Sign-in keeps the page](/tasks/${MENTIONED_TASK.id}) here.`,
    );
  });

  it("closes only the picker on Escape", () => {
    const page = editorWith(() => undefined);
    const heardOutside = vi.fn<(event: Event) => void>();
    document.addEventListener("keydown", heardOutside);

    type(page, "@");
    expect(options(page)).toHaveLength(1);
    press(page, "Escape");

    expect(options(page)).toEqual([]);
    expect(heardOutside).not.toHaveBeenCalled();
    document.removeEventListener("keydown", heardOutside);
  });
});
