import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Attachment, Project, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { type addFile, type createTask, taskQueries } from "../../api/work.ts";
import { paste, screenshot } from "../attachments/pasted-files.fixtures.ts";
import { buttonNamed, shownText, typed, until } from "../page.fixtures.tsx";
import { ToastProvider } from "../toasts.tsx";
import { NewTaskDialog } from "./new-task-dialog.tsx";

const api = vi.hoisted(() => ({
  createTask: vi.fn<typeof createTask>(),
  addFile: vi.fn<typeof addFile>(),
}));
vi.mock("../../api/work.ts", async (original) => ({
  ...(await original<typeof import("../../api/work.ts")>()),
  createTask: api.createTask,
  addFile: api.addFile,
}));

const PROJECT = { id: "api-service", name: "API service", mark: { label: "AP", colour: "teal" } };
const TASK = {
  id: "7a1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Fix the login",
  state: "backlog",
};

let root: Root | undefined;

async function openNewTask(): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(projectQueries.list().queryKey, [PROJECT as Project]);
  queryClient.setQueryData(taskQueries.list().queryKey, [] as Task[]);
  const rootRoute = createRootRoute({
    component: () => <NewTaskDialog projectId={PROJECT.id} onClose={() => undefined} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/tasks/$taskId",
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
}

function chipNames(): string[] {
  return [...document.querySelectorAll(".pending-attachments .attachment-open")].map(shownText);
}

/** As a browser sends a press that starts and ends on the window's dimmed backdrop. */
function pressOutside(): void {
  const backdrop = document.body.querySelector(".dialog-backdrop");
  if (!backdrop) throw new Error("There is no window open.");
  for (const type of ["pointerdown", "pointerup", "click"]) {
    act(() => backdrop.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
  }
}

async function addTheTask(): Promise<void> {
  await act(async () => buttonNamed(document.body, "Add the Task")?.click());
}

describe("New Task", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json([])));
    api.createTask.mockResolvedValue(TASK as Task);
    api.addFile.mockImplementation((_owner, file) =>
      Promise.resolve({ name: file.name } as Attachment),
    );
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("lists a pasted image and attaches it, in order, once the Task is added", async () => {
    await openNewTask();
    typed(document.body, "Title", TASK.title);
    expect(paste(document.body, [screenshot("first.png")])).toBe(true);
    paste(document.body, [screenshot("second.png")]);
    expect(chipNames()).toEqual(["first.png", "second.png"]);

    await addTheTask();

    await until(() => expect(api.addFile).toHaveBeenCalledTimes(2));
    expect(api.createTask).toHaveBeenCalledOnce();
    expect(api.addFile.mock.calls.map(([owner, file]) => [owner, file.name])).toEqual([
      [{ kind: "task", taskId: TASK.id }, "first.png"],
      [{ kind: "task", taskId: TASK.id }, "second.png"],
    ]);
  });

  it("tries again only the Attachments left, never adding the Task twice", async () => {
    await openNewTask();
    typed(document.body, "Title", TASK.title);
    paste(document.body, [screenshot("first.png")]);
    paste(document.body, [screenshot("second.png")]);
    api.addFile
      .mockResolvedValueOnce({ name: "first.png" } as Attachment)
      .mockRejectedValueOnce(new Error("The disk is full."));

    await addTheTask();

    await until(() =>
      expect(shownText(document.body)).toContain("The Task is added, but not every Attachment yet"),
    );
    expect(chipNames()).toEqual(["second.png"]);

    await addTheTask();

    await until(() => expect(api.addFile).toHaveBeenCalledTimes(3));
    expect(api.createTask).toHaveBeenCalledOnce();
    expect(api.addFile.mock.calls[2]?.[1].name).toBe("second.png");
  });

  it("leaves a paste of text to the field, attaching nothing", async () => {
    await openNewTask();
    const title = document.body.querySelector("input");
    if (!title) throw new Error("There is no Title field.");

    expect(paste(title, [screenshot()], "Fix the login")).toBe(false);

    expect(chipNames()).toEqual([]);
  });

  it("asks before a press outside closes it with a title typed", async () => {
    await openNewTask();
    typed(document.body, "Title", TASK.title);

    pressOutside();

    expect(shownText(document.body)).toContain(
      "Close without saving? What you entered here will be lost.",
    );
    expect(buttonNamed(document.body, "Close without saving")).toBeDefined();
  });
});
