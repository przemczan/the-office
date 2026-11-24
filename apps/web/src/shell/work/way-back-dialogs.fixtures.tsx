import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task, TaskWaysBack } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { shownText } from "../page.fixtures.tsx";
import { ToastProvider } from "../toasts.tsx";

/** What the ways-back windows' tests share: a Task, its ways back, and the window rendered. */

export const TASK = {
  id: "7a1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Login fails after a reset",
  projectId: "the-office",
  state: "paused",
} as Task;

const OFFERED = { offered: true, why: null };

export function aWaysBack(fields: Partial<TaskWaysBack> = {}): TaskWaysBack {
  return {
    restart: OFFERED,
    startOver: OFFERED,
    reopen: OFFERED,
    reopenToReady: OFFERED,
    started: true,
    resetTo: "main",
    ...fields,
  };
}

let root: Root | undefined;

/** Renders `window` with a fresh cache `seed` fills; returns the cache. */
export function rendered(
  window: ReactNode,
  seed: (queryClient: QueryClient) => void = () => undefined,
): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  seed(queryClient);
  const page = document.createElement("div");
  document.body.append(page);
  act(() => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{window}</ToastProvider>
      </QueryClientProvider>,
    );
  });
  return queryClient;
}

export function unmounted(): void {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
}

/** The button whose words are `name`. */
export function button(name: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(
    (each) => shownText(each) === name,
  );
  if (!found) throw new Error(`There is no button ${name}.`);
  return found;
}

/** The checkbox or radio whose line reads `name`. */
export function choice(name: string): HTMLInputElement {
  const label = [...document.body.querySelectorAll("label")].find(
    (each) => each.textContent.trim() === name,
  );
  const input = label?.querySelector("input");
  if (!input) throw new Error(`There is no choice ${name}.`);
  return input;
}

/** Writes `text` into the box labelled `label`. */
export function written(label: string, text: string): void {
  const labelElement = [...document.body.querySelectorAll("label")].find(
    (each) => each.textContent.trim() === label,
  );
  const box = labelElement && document.getElementById(labelElement.htmlFor);
  if (!(box instanceof HTMLTextAreaElement)) throw new Error(`There is no box labelled ${label}.`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
