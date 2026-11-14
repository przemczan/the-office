import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { ToastProvider } from "./toasts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** What the service answers, by method and path, given the request's JSON body. */
export type Answers = Record<
  string,
  (body: unknown) => { readonly status: number; readonly body?: unknown }
>;

/** A request the page sent, by method and path, with its JSON body. */
export interface Sent {
  readonly request: string;
  readonly body: unknown;
}

let root: Root | undefined;

/**
 * Answers the page's requests as `answers` says, a request it doesn't name with 404, and records
 * each one sent.
 */
export function stubService(answers: Answers): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      sent.push({ request, body });
      const answer = answers[request];
      if (answer === undefined) return Response.json({ message: "Not here." }, { status: 404 });
      const { status, body: answered } = answer(body);
      return answered === undefined
        ? new Response(null, { status })
        : Response.json(answered, { status });
    }),
  );
  return sent;
}

/**
 * Opens `path` in a router of the pages given by path (`"/"` for home), each under the shell's
 * toasts, with a fresh query client.
 */
export async function openPage(
  path: string,
  pages: Readonly<Record<string, () => ReactNode>>,
): Promise<{ readonly page: HTMLElement; readonly router: AnyRouter }> {
  const rootRoute = createRootRoute({ component: Outlet });
  const routes = Object.entries(pages).map(([pagePath, component]) =>
    createRoute({ getParentRoute: () => rootRoute, path: pagePath, component }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  });
  return { page, router };
}

/** Closes the page `openPage` opened and forgets the service's stub. */
export function closePage(): void {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
}

/** Lets the page answer until `check` holds. */
export async function until(check: () => void): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    check();
  });
}

/** Types into the field labelled `label`. */
export function typed(page: HTMLElement, label: string, text: string): void {
  const labelElement = [...page.querySelectorAll("label")].find(
    (candidate) => candidate.textContent?.replace("*", "").trim() === label,
  );
  const input = labelElement && document.getElementById(labelElement.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`There is no field labelled ${label}.`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The button whose accessible name is `name`: its label, else its text. */
export function buttonNamed(scope: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => (button.getAttribute("aria-label") ?? shownText(button)) === name,
  );
}

/** An element's text as shown, leaving out the styles the design system's controls carry. */
export function shownText(element: Element): string {
  const shown = element.cloneNode(true) as Element;
  for (const style of shown.querySelectorAll("style")) style.remove();
  return shown.textContent?.trim() ?? "";
}
