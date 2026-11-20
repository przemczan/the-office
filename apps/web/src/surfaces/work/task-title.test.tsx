import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskTitle } from "./task-title.tsx";

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

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function aTask(state: Task["state"]): Task {
  return { id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c", title: "Remember the sort", state } as Task;
}

async function show(state: Task["state"]): Promise<{ page: HTMLElement; fetcher: typeof fetch }> {
  const fetcher = vi.fn<typeof fetch>(async () => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetcher);
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <TaskTitle task={aTask(state)} />
      </QueryClientProvider>,
    );
  });
  return { page, fetcher };
}

const pencil = (page: HTMLElement): HTMLElement | null =>
  page.querySelector('[aria-label="Edit the title"]');

async function openField(page: HTMLElement): Promise<HTMLInputElement> {
  await act(async () => pencil(page)?.click());
  const field = page.querySelector<HTMLInputElement>('input[aria-label="Task title"]');
  if (!field) throw new Error("no field");
  return field;
}

async function type(field: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("a Task's title", () => {
  it("turns into a field, and Enter saves the new title", async () => {
    const { page, fetcher } = await show("in-progress");

    const field = await openField(page);
    expect(field.value).toBe("Remember the sort");
    await type(field, "Remember the sort and filters");
    await act(async () => {
      page.querySelector("form")?.requestSubmit();
    });

    const [url, init] = vi.mocked(fetcher).mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/tasks/6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c/title");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ title: "Remember the sort and filters" }));
  });

  it("goes back to the title on Escape, saving nothing", async () => {
    const { page, fetcher } = await show("backlog");

    const field = await openField(page);
    await type(field, "Something else");
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(page.querySelector("h2")?.textContent).toBe("Remember the sort");
    expect(page.querySelector("input")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["done", "dropped"] as const)("has no pencil once the Task is %s", async (state) => {
    const { page } = await show(state);

    expect(page.querySelector("h2")?.textContent).toBe("Remember the sort");
    expect(pencil(page)).toBeNull();
  });
});
