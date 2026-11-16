import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import type { Idea, Project, Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { type captureIdea, type createTask, taskQueries } from "../../api/work.ts";
import { shownText, typed, until } from "../page.fixtures.tsx";
import { ToastProvider } from "../toasts.tsx";
import { CreateDialog } from "./create-dialog.tsx";

const api = vi.hoisted(() => ({
  createTask: vi.fn<typeof createTask>(),
  captureIdea: vi.fn<typeof captureIdea>(),
}));
vi.mock("../../api/work.ts", async (original) => ({
  ...(await original<typeof import("../../api/work.ts")>()),
  createTask: api.createTask,
  captureIdea: api.captureIdea,
}));

const API = { id: "api-service", name: "API service", mark: { label: "AP", colour: "teal" } };
const WEB = { id: "web-app", name: "Web app", mark: { label: "WE", colour: "blue" } };
const TASK = {
  id: "7a1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Fix the login",
  state: "backlog",
};
const IDEA = { id: "0b6c1d2e-3f4a-4b5c-8d6e-7f8a9b0c1d2e", title: "Fix the login" };

let root: Root | undefined;
let router: AnyRouter | undefined;
const onClose = vi.fn<() => void>();

async function openCreate(): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(projectQueries.list().queryKey, [API, WEB] as Project[]);
  queryClient.setQueryData(taskQueries.list().queryKey, [] as Task[]);
  const rootRoute = createRootRoute({
    component: () => <CreateDialog projectId={API.id} onClose={onClose} />,
  });
  router = createRouter({
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
          <RouterProvider router={router as AnyRouter} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router?.load();
  });
}

/**
 * An element's words, leaving out the design system's styles. Read without cloning, as `shownText`
 * does: jsdom can't clone the chosen tab's inline background.
 */
function wordsOf(element: Element): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let words = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("style") === null) words += node.textContent ?? "";
  }
  return words.trim();
}

function pageText(): string {
  return wordsOf(document.body);
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((button) => wordsOf(button) === name);
}

function tab(name: "Task" | "Idea"): HTMLElement {
  const found = [...document.body.querySelectorAll<HTMLElement>("[role=tab]")].find(
    (candidate) => wordsOf(candidate) === name,
  );
  if (!found) throw new Error(`There is no ${name} to choose.`);
  return found;
}

function choose(name: "Task" | "Idea"): void {
  act(() => tab(name).click());
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const labelElement = [...document.body.querySelectorAll("label")].find(
    (candidate) => candidate.textContent?.replace("*", "").trim() === label,
  );
  const element = labelElement && document.getElementById(labelElement.htmlFor);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error(`There is no field labelled ${label}.`);
  }
  return element;
}

function written(label: string, text: string): void {
  const textarea = field(label);
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The Project chosen, by the name its radio shows. */
function chosenProject(): string {
  const label = document.body.querySelector("[role=radio][aria-checked=true]")?.closest("label");
  return label ? shownText(label) : "";
}

function chooseProject(name: string): void {
  const label = [...document.body.querySelectorAll<HTMLElement>("[role=radiogroup] label")].find(
    (candidate) => shownText(candidate).includes(name),
  );
  if (!label) throw new Error(`There is no Project ${name} to choose.`);
  act(() => label.click());
}

async function press(name: string): Promise<void> {
  await act(async () => buttonNamed(name)?.click());
}

describe("Create", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json([])));
    api.createTask.mockResolvedValue(TASK as Task);
    api.captureIdea.mockResolvedValue(IDEA as Idea);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    router = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("opens on Task, as New Task in the Project it starts in", async () => {
    await openCreate();

    expect(tab("Task").getAttribute("aria-selected")).toBe("true");
    expect(tab("Idea").getAttribute("aria-selected")).toBe("false");
    expect(pageText()).toContain("New Task");
    expect(buttonNamed("Add the Task")).toBeDefined();
    expect(chosenProject()).toContain(API.name);
  });

  it("keeps the title, the Description as notes and the Project when switching", async () => {
    await openCreate();
    typed(document.body, "Title", "Fix the login");
    written("Description", "It loops back to the sign-in page.");
    chooseProject(WEB.name);

    choose("Idea");

    expect(pageText()).toContain("Capture an Idea");
    expect(field("Idea").value).toBe("Fix the login");
    expect(field("Notes").value).toBe("It loops back to the sign-in page.");
    expect(chosenProject()).toContain(WEB.name);

    typed(document.body, "Idea", "Fix the login for good");
    choose("Task");

    expect(field("Title").value).toBe("Fix the login for good");
    expect(field("Description").value).toBe("It loops back to the sign-in page.");
    expect(chosenProject()).toContain(WEB.name);
  });

  it("adds the Task and opens its page when Task is chosen", async () => {
    await openCreate();
    typed(document.body, "Title", TASK.title);

    await press("Add the Task");

    await until(() => expect(router?.state.location.pathname).toBe(`/tasks/${TASK.id}`));
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: TASK.title, description: "", projectId: API.id }),
    );
    expect(api.captureIdea).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("captures the Idea when Idea is chosen, Office-wide if the user says so", async () => {
    await openCreate();
    choose("Idea");
    typed(document.body, "Idea", IDEA.title);
    written("Notes", "Seen twice this week.");
    chooseProject("Office-wide");

    await press("Capture");

    await until(() => expect(pageText()).toContain(`Idea captured: ${IDEA.title}.`));
    expect(api.captureIdea).toHaveBeenCalledWith({
      title: IDEA.title,
      notes: "Seen twice this week.",
      projectId: null,
    });
    expect(api.createTask).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
