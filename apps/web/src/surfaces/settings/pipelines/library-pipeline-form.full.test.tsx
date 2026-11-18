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
  ProjectPipelineBreak,
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

const BREAK: ProjectPipelineBreak = {
  projectPipelineId: "full-with-linux",
  name: "Full with Linux check",
  projectId: "the-office",
  projectName: "the-office",
  reasons: [
    {
      stageChangeIndex: 0,
      stageIndex: null,
      stageKey: "review",
      text: "Inserts Verify on Linux after Review, which Full no longer has.",
    },
  ],
};

/**
 * Answers the check with `breaks` and `problems` and a save with the Pipeline, recording what was
 * sent.
 */
function serving(breaks: readonly ProjectPipelineBreak[], problems: readonly StageProblem[] = []) {
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
      const check: PipelineCheck = { problems: [...problems], breaks: [...breaks] };
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

describe("saving an office-wide Pipeline that Project Pipelines are built from", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("warns first, naming each one with its Project and why, and Save anyway saves", async () => {
    const fetched = serving([BREAK]);
    const page = await rendered();
    await describeIt(page, "Implement, test and publish.");
    expect(page.textContent).toContain("Saving breaks 1 Project Pipeline");
    expect(page.textContent).toContain("the-office's Full with Linux check name Stages");

    await press("Save the Pipeline");
    expect(saves(fetched)).toBe(0);
    const warning = document.querySelector('[role="dialog"]');
    expect(warning?.textContent).toContain("Saving Full breaks 1 Project Pipeline");
    expect(warning?.textContent).toContain("Full with Linux check");
    expect(warning?.textContent).toContain("the-office");
    expect(warning?.textContent).toContain(BREAK.reasons[0]?.text);
    expect(warning?.textContent).toContain("Open it on the-office's page");

    await press("Save anyway");
    expect(saves(fetched)).toBe(1);
  });

  it("saves at once when it breaks nothing", async () => {
    const fetched = serving([]);
    const page = await rendered();
    await describeIt(page, "Implement, test and publish.");
    expect(page.textContent).not.toContain("Saving breaks");
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
    serving([]);
    const page = await rendered();
    expect(page.textContent).toContain("Stages and routes");
    expect(page.textContent).toContain("2 Stages · 2 routes · 0 On failure loops");
    expect(page.querySelector('[role="region"][aria-label="Flow"]')).not.toBeNull();
    expect(page.textContent).toContain("Full is now drawn as a flow");

    await press("Hide this note");
    expect(page.textContent).not.toContain("Full is now drawn as a flow");
    expect(localStorage.getItem("the-office.converted-note-hidden.full")).toBe("true");
  });

  it("holds Save while a problem stands, saying how many", async () => {
    const problem: StageProblem = {
      stageKey: "review",
      at: { kind: "stage" },
      level: "problem",
      text: "Review has no route out: add one to a later Stage, or to End to make it a final Stage.",
    };
    const fetched = serving([], [problem]);
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
