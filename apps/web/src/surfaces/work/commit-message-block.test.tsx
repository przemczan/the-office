import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMMIT_MESSAGE_PUBLISHED,
  CommitMessageBlock,
  commitMessageSummary,
  NO_COMMIT_MESSAGE,
} from "./commit-message-block.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RUNNING_TASK: Task = {
  id: "00000000-0000-4000-8000-000000000031",
  title: "Sign-in keeps the page",
  description: "Keep the query string.",
  projectId: "firmware",
  priority: "normal",
  tags: [],
  state: "in-progress",
  plan: "Keep the path.",
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
  definitionOfDone: ["Sign-in returns."],
  definitionOfDoneConfirmed: true,
  commitMessage: "Sign-in keeps the page\n\nKeep the query string.",
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
  pullRequestEnd: null,
};

const PUBLISHED_TASK: Task = {
  ...RUNNING_TASK,
  state: "done",
  commitMessage: "fix(auth): keep the page after sign-in",
  commitMessageWritten: true,
  commitMessagePublishedAt: "2026-11-15T10:00:00.000Z",
};

function blockOf(task: Task): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <CommitMessageBlock task={task} />
      </QueryClientProvider>,
    ),
  );
  return page;
}

/** By the words it starts with: a Button also holds its spinner's styles. */
function button(page: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find((found) => found.textContent.startsWith(name));
}

describe("the commit message block", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("shows the default Publish uses while none is written, with Edit", () => {
    const page = blockOf(RUNNING_TASK);

    expect(page.querySelector("pre")?.textContent).toBe(
      "Sign-in keeps the page\n\nKeep the query string.",
    );
    expect(page.textContent).toContain(NO_COMMIT_MESSAGE);
    expect(button(page, "Edit")).toBeDefined();
  });

  it("saves the user's message to the Task's commit message", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({ ...RUNNING_TASK, commitMessage: "Mine", commitMessageWritten: true }),
      ),
    );
    vi.stubGlobal("fetch", fetched);
    const page = blockOf(RUNNING_TASK);

    act(() => button(page, "Edit")?.click());
    await act(async () => {
      page.querySelector("form")?.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve));
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(`/api/tasks/${RUNNING_TASK.id}/commit-message`);
    expect(request?.method).toBe("PUT");
    expect(JSON.parse(String(request?.body))).toEqual({ message: RUNNING_TASK.commitMessage });
  });

  it("shows the message as published, with no Edit, once Publish landed it", () => {
    const page = blockOf(PUBLISHED_TASK);

    expect(page.querySelector("pre")?.textContent).toBe("fix(auth): keep the page after sign-in");
    expect(page.textContent).toContain(COMMIT_MESSAGE_PUBLISHED);
    expect(page.textContent).not.toContain(NO_COMMIT_MESSAGE);
    expect(button(page, "Edit")).toBeUndefined();
  });

  it("folds to the message's subject, saying when it is the default or published", () => {
    expect(commitMessageSummary(RUNNING_TASK)).toBe("Default · Sign-in keeps the page");
    expect(commitMessageSummary({ ...RUNNING_TASK, commitMessageWritten: true })).toBe(
      "Sign-in keeps the page",
    );
    expect(commitMessageSummary(PUBLISHED_TASK)).toBe(
      "Published · fix(auth): keep the page after sign-in",
    );
  });
});
