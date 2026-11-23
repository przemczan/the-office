import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  Pipeline,
  PipelineCheck,
  Project,
  RoleCardOptions,
  StageProblem,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectQueries } from "../../../api/projects.ts";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { LibraryPipelineForm } from "./library-pipeline-form.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FULL: Pipeline = {
  id: "full",
  name: "Full",
  description: "Implement, test, review and publish.",
  stages: [
    { kind: "script", key: "tests", name: "Tests", optional: false, command: "test" },
    { kind: "gate", key: "review", name: "Review", optional: false },
  ],
};

const PROJECTS = [
  { id: "the-office", name: "the-office", mark: { label: "TO", colour: "violet" }, commands: [] },
] as unknown as Project[];

/** Answers the check with `problems` and a save with the Pipeline, recording what was sent. */
function serving(problems: readonly StageProblem[] = []) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  const fetched = vi.fn<typeof fetch>((input, init) => {
    const url = String(input);
    if (url.endsWith("/pipelines/check")) {
      const check: PipelineCheck = { problems: [...problems] };
      return Promise.resolve(Response.json(check));
    }
    if (init?.method === "PUT")
      return Promise.resolve(Response.json({ ...FULL, ...JSON.parse(String(init.body)) }));
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

async function rendered(): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(projectQueries.list().queryKey, PROJECTS);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ToastProvider>
          <LibraryPipelineForm
            pipeline={FULL}
            roles={[]}
            duties={[]}
            options={{} as RoleCardOptions}
            onDone={() => undefined}
          />
        </ToastProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

async function describeIt(page: HTMLElement, text: string): Promise<void> {
  const description = page.querySelector("textarea");
  if (!description) throw new Error("No Description.");
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(description, text);
    description.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // The check answers the draft.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function press(label: string): Promise<void> {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => wordsOf(candidate) === label,
  );
  if (!button) throw new Error(`No button "${label}".`);
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function saves(fetched: ReturnType<typeof serving>): number {
  return fetched.mock.calls.filter(([, init]) => init?.method === "PUT").length;
}

describe("saving an office-wide Pipeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("saves at once, with no window first", async () => {
    const fetched = serving();
    const page = await rendered();
    await describeIt(page, "Implement, test and publish.");
    await press("Save the Pipeline");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(saves(fetched)).toBe(1);
  });
});

describe("an office-wide Pipeline in the flow editor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    localStorage.clear();
  });

  it("shows its Stages as a flow, and says once that it was converted", async () => {
    serving();
    const page = await rendered();
    expect(page.textContent).toContain("Stages and routes");
    expect(page.textContent).toContain("2 Stages · 2 routes · 0 routes back");
    expect(page.querySelector('[role="region"][aria-label="Flow"]')).not.toBeNull();
    expect(page.textContent).toContain("Full now goes back by routes");

    await press("Hide this note");
    expect(page.textContent).not.toContain("Full now goes back by routes");
    expect(localStorage.getItem("the-office.converted-note-hidden.full")).toBe("true");
  });

  it("holds Save while a problem stands, saying how many", async () => {
    const problem: StageProblem = {
      stageKey: "review",
      at: { kind: "stage" },
      level: "problem",
      text: "Review has no route out: add one to a later Stage, or to End to make it a final Stage.",
    };
    const fetched = serving([problem]);
    const page = await rendered();
    await describeIt(page, "Implement, test and publish.");
    expect(page.textContent).toContain("1 problem holds Save");
    const save = [...document.querySelectorAll("button")].find(
      (button) => wordsOf(button) === "Save the Pipeline",
    );
    expect(save?.disabled).toBe(true);
    await press(problem.text);
    expect(document.querySelector('section[aria-label="Review"]')).not.toBeNull();
    expect(saves(fetched)).toBe(0);
  });
});

/** A button's words: the design system's Button holds a <style>, whose text isn't its label. */
function wordsOf(button: HTMLButtonElement): string {
  return [...button.childNodes]
    .filter(({ nodeName }) => nodeName !== "STYLE")
    .map(({ textContent }) => textContent)
    .join("");
}
