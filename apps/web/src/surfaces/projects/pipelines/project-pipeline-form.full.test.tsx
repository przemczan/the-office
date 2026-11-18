import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  OfficeWidePipeline,
  Project,
  ProjectPipeline,
  ProjectPipelineCheck,
  RoleCardOptions,
  Stage,
  StageChange,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleQueries } from "../../../api/people.ts";
import { ChatProvider } from "../../../shell/chat/use-chat.tsx";
import { ThreadDraftsProvider } from "../../../shell/conversation/thread-drafts.tsx";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { ProjectPipelineForm } from "./project-pipeline-form.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TESTS: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  place: { column: 0, row: 0 },
  routes: [{ to: "write", condition: null }],
};
const WRITE: Stage = {
  kind: "gate",
  key: "write",
  name: "Write",
  optional: false,
  place: { column: 1, row: 0 },
  routes: [{ to: null, condition: null }],
};

const PROJECT = {
  id: "the-office",
  name: "the-office",
  defaultPipeline: "full",
  publishingMode: "merge",
  baseBranch: "main",
  commands: [{ key: "test", name: "Test", kind: "test", commandLine: "npm test" }],
  mark: { label: "TO", colour: "violet" },
} as unknown as Project;

const DOCUMENT: OfficeWidePipeline = {
  id: "document",
  name: "Document",
  description: "",
  stages: [TESTS, WRITE],
  builtOnBy: [],
};

/** Spec change: its Change of Produce no longer applies, as Document has Write instead. */
const PRODUCE_CHANGE: ProjectPipeline["stageChanges"][number] = {
  kind: "change",
  stageKey: "produce",
  stageName: "Produce",
  fields: { optional: true },
};

const SPEC_CHANGE: ProjectPipeline = {
  id: "spec-change",
  projectId: "the-office",
  name: "Spec change",
  description: "",
  basePipeline: { id: "document", name: "Document" },
  stageChanges: [PRODUCE_CHANGE],
  rows: [
    { stage: TESTS, origin: "base", stageChangeIndexes: [], baseStage: TESTS, changedFields: [] },
    { stage: WRITE, origin: "base", stageChangeIndexes: [], baseStage: WRITE, changedFields: [] },
  ],
  stages: [TESTS, WRITE],
  broken: [
    {
      stageChangeIndex: 0,
      stageIndex: null,
      stageKey: "produce",
      text: "Changes Produce, which Document no longer has.",
    },
  ],
};

/** The Stage changes the editor last asked the service to check. */
const checked: { stageChanges: readonly StageChange[] } = { stageChanges: [] };

/** Builds the check from the draft as the service would here: Broken while it names Produce. */
function serving(removal: Response = new Response(null, { status: 204 })) {
  const fetched = vi.fn<typeof fetch>((input, init) => {
    const url = String(input);
    if (url.endsWith("/project-pipelines/check")) {
      const { stageChanges } = JSON.parse(String(init?.body)) as ProjectPipeline;
      checked.stageChanges = stageChanges;
      const check: ProjectPipelineCheck = {
        problems: [],
        rows: SPEC_CHANGE.rows,
        stages: SPEC_CHANGE.stages,
        broken: stageChanges.some(({ stageKey }) => stageKey === "produce")
          ? SPEC_CHANGE.broken
          : [],
      };
      return Promise.resolve(Response.json(check));
    }
    if (init?.method === "DELETE") return Promise.resolve(removal.clone());
    if (url.endsWith("/use")) {
      return Promise.resolve(
        Response.json({
          defaultFor: [],
          notStarted: 1,
          running: 0,
          initiatives: 0,
          projectPipelines: [],
        }),
      );
    }
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

async function rendered(): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ThreadDraftsProvider>
          <ChatProvider>
            <ToastProvider>
              <ProjectPipelineForm
                project={PROJECT}
                projectPipeline={SPEC_CHANGE}
                officeWide={[DOCUMENT]}
                roles={[]}
                duties={[]}
                options={{} as RoleCardOptions}
              />
            </ToastProvider>
          </ChatProvider>
        </ThreadDraftsProvider>
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
  await settled();
  return page;
}

async function settled(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function buttonNamed(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label || wordsOf(candidate) === label,
  );
  if (!found) throw new Error(`No button "${label}".`);
  return found;
}

async function press(label: string): Promise<void> {
  await act(async () => buttonNamed(label).click());
  await settled();
}

describe("a Project Pipeline's editor", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("flags a Broken one with why, holds Save, and saves once the Stage change is fixed", async () => {
    serving();
    const page = await rendered();
    expect(
      page.querySelector('[role="group"][aria-label="1 Stage change doesn\'t apply to Document"]'),
    ).not.toBeNull();
    expect(buttonNamed("Save the Pipeline").disabled).toBe(true);
    expect(page.textContent).toContain(
      "Spec change is Broken: 1 Stage change no longer applies to Document",
    );
    expect(page.textContent).toContain("Changes Produce, which Document no longer has.");

    await press("Remove this Stage change");
    expect(page.textContent).toContain("Fixed: save it, and Tasks can choose Spec change again");
    expect(buttonNamed("Save the Pipeline").disabled).toBe(false);
  });

  it("inserts a Stage after the picked one from the head's menu", async () => {
    serving();
    const page = await rendered();
    expect(page.textContent).toContain("What the-office gets");
    expect(buttonNamed("Insert a Stage").disabled).toBe(true);
    await press("Tests");
    await press("Insert after Tests");
    await press("Gate");
    expect(checked.stageChanges).toEqual([
      PRODUCE_CHANGE,
      expect.objectContaining({
        kind: "insert-after",
        stageKey: "tests",
        stageName: "Tests",
        stage: expect.objectContaining({ kind: "gate" }),
      }),
    ]);
    expect(page.textContent).toContain("was inserted after Tests");
  });

  it("makes a Change routes of a route's edit, compares it with the base, and Undo drops it", async () => {
    serving();
    const page = await rendered();
    await press("Tests");
    await press("Remove the route to Write");
    expect(checked.stageChanges).toEqual([
      PRODUCE_CHANGE,
      { kind: "change-routes", stageKey: "tests", stageName: "Tests", routes: [] },
    ]);
    expect(page.textContent).toContain("Routes changed");
    const compare = page.querySelector('[role="group"][aria-label="Tests\'s routes"]');
    expect(compare?.textContent).toContain("Document has1. → Write, always");
    expect(compare?.textContent).toContain("the-office gets");
    expect(page.textContent).toContain("Unsaved changes");

    await press("Undo: give Tests Document's routes back");
    expect(page.textContent).not.toContain("Routes changed");
    expect(page.textContent).toContain("Saved");
    expect(buttonNamed("Save the Pipeline").disabled).toBe(true);
  });

  it("asks before removing it, and shows the service's reason when it is refused", async () => {
    const fetched = serving(
      Response.json(
        {
          statusCode: 422,
          message: "Spec change is the-office's default.",
          reasons: ["Spec change is the-office's default."],
        },
        { status: 422 },
      ),
    );
    await rendered();
    await press("Remove");
    expect(fetched.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Remove Spec change?");
    await press("Remove the Pipeline");
    expect(document.body.textContent).toContain("Spec change can't be removed");
    expect(document.body.textContent).toContain("Spec change is the-office's default.");
  });
});

/** A button's words: the design system's Button holds a <style>, whose text isn't its label. */
function wordsOf(button: HTMLButtonElement): string {
  return [...button.childNodes]
    .filter(({ nodeName }) => nodeName !== "STYLE")
    .map(({ textContent }) => textContent)
    .join("");
}
