import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { IssueLink, Project, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { type dropTask, taskQueries } from "../../api/work.ts";
import { until } from "../page.fixtures.tsx";
import { ToastProvider } from "../toasts.tsx";
import { dropReasonOf, NO_DROP_REASON } from "./drop-reason-field.tsx";
import { DropTaskDialog } from "./drop-task-dialog.tsx";

const api = vi.hoisted(() => ({ dropTask: vi.fn<typeof dropTask>() }));
vi.mock("../../api/work.ts", async (original) => ({
  ...(await original<typeof import("../../api/work.ts")>()),
  dropTask: api.dropTask,
}));

const TASK = {
  id: "7a1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Login fails after a reset",
  projectId: "the-office",
  state: "backlog",
} as Task;
const OTHER = {
  id: "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6",
  title: "Password reset leaves an old session",
  projectId: "the-office",
  state: "done",
} as Task;
const PROJECT = {
  id: "the-office",
  name: "the-office",
  issueSettings: { closeOnDrop: true },
} as unknown as Project;
const ISSUE = { number: 7 } as IssueLink;

let root: Root | undefined;

function open(issue: IssueLink | null = null): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(taskQueries.list().queryKey, [TASK, OTHER]);
  queryClient.setQueryData(projectQueries.list().queryKey, [PROJECT]);
  queryClient.setQueryData(projectQueries.issueLink(TASK.id).queryKey, issue);
  const page = document.createElement("div");
  document.body.append(page);
  act(() => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <DropTaskDialog task={TASK} onClose={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
}

function radio(name: string): HTMLInputElement {
  const label = [...document.body.querySelectorAll(".radio-list-item")].find(
    (item) => item.textContent === name,
  );
  const input = label?.querySelector("input");
  if (!input) throw new Error(`There is no reason ${name}.`);
  return input;
}

function dropButton(): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find((each) =>
    each.textContent.includes("Drop the Task"),
  );
  if (!button) throw new Error("There is no Drop the Task.");
  return button;
}

describe("Drop's reason", () => {
  beforeEach(() => api.dropTask.mockResolvedValue({ ...TASK, state: "dropped" }));

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("drops with no reason when none is picked", async () => {
    open();

    await act(async () => dropButton().click());

    await until(() => expect(api.dropTask).toHaveBeenCalledWith(TASK.id, undefined));
  });

  it("clears the reason when the picked one is pressed again", () => {
    open();
    act(() => radio("Won't fix").click());
    expect(radio("Won't fix").checked).toBe(true);

    act(() => radio("Won't fix").click());

    expect(radio("Won't fix").checked).toBe(false);
  });

  it("waits for the Task a Duplicate duplicates, saying so on hover", () => {
    open();

    act(() => radio("Duplicate").click());

    expect(dropButton().disabled).toBe(true);
    expect(dropButton().title).toBe("Pick the Task it duplicates");
    expect(document.body.querySelector('[role="combobox"]')).not.toBeNull();
  });

  it("sends the reason picked", async () => {
    open();
    act(() => radio("Can't reproduce").click());

    await act(async () => dropButton().click());

    await until(() =>
      expect(api.dropTask).toHaveBeenCalledWith(TASK.id, { kind: "cant-reproduce" }),
    );
  });

  it("says the GitHub issue closes with the reason, while the Project closes them", () => {
    open(ISSUE);

    expect(document.body.textContent).toContain(
      "GitHub issue #7 will be closed with this reason, as the-office closes issues of dropped Tasks.",
    );
  });
});

describe("dropReasonOf", () => {
  it("sends none, or the reason once it has what it needs", () => {
    expect(dropReasonOf(NO_DROP_REASON)).toEqual({});
    expect(dropReasonOf({ ...NO_DROP_REASON, kind: "other", text: "  " })).toEqual({
      missing: "Write the reason first",
    });
    expect(dropReasonOf({ ...NO_DROP_REASON, kind: "other", text: " Too old " })).toEqual({
      reason: { kind: "other", text: "Too old" },
    });
    expect(dropReasonOf({ ...NO_DROP_REASON, kind: "duplicate", taskId: OTHER.id })).toEqual({
      reason: { kind: "duplicate", taskId: OTHER.id },
    });
  });
});
