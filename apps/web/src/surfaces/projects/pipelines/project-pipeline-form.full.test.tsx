import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  PipelineEdit,
  Project,
  ProjectPipeline,
  ProjectPipelineCheck,
  ProjectPipelineCheckRequest,
  RoleCardOptions,
  Stage,
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
  position: { x: 0, y: 0 },
  routes: [{ to: "write", condition: null }],
};
const WRITE: Stage = {
  kind: "gate",
  key: "write",
  name: "Write",
  optional: false,
  position: { x: 308, y: 0 },
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

const NORMAL: ProjectPipeline = {
  id: "docs-for-the-office",
  projectId: "the-office",
  name: "Document for the-office",
  description: "",
  stages: [TESTS, WRITE],
  copiedFrom: { name: "Document", at: "2026-11-12T10:00:00.000Z" },
  brokenBeforeUpdate: null,
};

/** Spec change: Broken before The Office updated, as its Change of Produce no longer applied. */
const SPEC_CHANGE: ProjectPipeline = {
  ...NORMAL,
  id: "spec-change",
  name: "Spec change",
  copiedFrom: { name: "Document", at: null },
  brokenBeforeUpdate: ["Changes Produce, which Document no longer had."],
};

/** What the editor last asked the service to check, and what it last saved. */
const sent: { checked?: ProjectPipelineCheckRequest; saved?: PipelineEdit } = {};

/** Answers the check with no problem, a save with the Pipeline saved, and the use line's counts. */
function serving(removal: Response = new Response(null, { status: 204 })) {
  sent.checked = undefined;
  sent.saved = undefined;
  const fetched = vi.fn<typeof fetch>((input, init) => {
    const url = String(input);
    if (url.endsWith("/project-pipelines/check")) {
      sent.checked = JSON.parse(String(init?.body)) as ProjectPipelineCheckRequest;
      const check: ProjectPipelineCheck = { problems: [] };
      return Promise.resolve(Response.json(check));
    }
    if (init?.method === "PUT") {
      sent.saved = JSON.parse(String(init.body)) as PipelineEdit;
      return Promise.resolve(
        Response.json({ ...SPEC_CHANGE, ...sent.saved, brokenBeforeUpdate: null }),
      );
    }
    if (init?.method === "DELETE") return Promise.resolve(removal.clone());
    if (url.endsWith("/use")) {
      return Promise.resolve(
        Response.json({ defaultFor: [], notStarted: 1, running: 0, initiatives: 0 }),
      );
    }
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

async function rendered(projectPipeline: ProjectPipeline = NORMAL): Promise<HTMLElement> {
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
                projectPipeline={projectPipeline}
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
    // "on 12 Nov" leaves the year out within the year.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T09:00:00.000Z"));
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("says what it was copied from in words, and edits its Stages in the flow editor", async () => {
    serving();
    const page = await rendered();
    expect(page.querySelector(".project-pipeline-facts")?.textContent).toBe(
      "Project Pipeline of the-office · Copied from Document on 12 Nov · 1 not started Task uses it · 0 running Tasks keep the copy they started with",
    );
    expect(page.querySelector(".project-pipeline-facts a")).toBeNull();
    expect(page.textContent).toContain("Stages and routes");
    expect(page.querySelector('[role="region"][aria-label="Flow"]')).not.toBeNull();
    expect(page.textContent).not.toContain("was Broken before The Office updated");
    expect(buttonNamed("Save the Pipeline").disabled).toBe(true);

    await press("Tests");
    await press("Remove the route to Write");
    expect(sent.checked).toEqual(
      expect.objectContaining({
        projectPipelineId: "docs-for-the-office",
        name: "Document for the-office",
        stages: [expect.objectContaining({ key: "tests", routes: [] }), WRITE],
      }),
    );
    expect(page.textContent).toContain("Unsaved changes");
    expect(buttonNamed("Save the Pipeline").disabled).toBe(false);

    await press("Discard");
    expect(page.textContent).toContain("Saved");
    expect(buttonNamed("Save the Pipeline").disabled).toBe(true);
  });

  it("flags one that was Broken before The Office updated with why, and saves it unchanged", async () => {
    serving();
    const page = await rendered(SPEC_CHANGE);
    expect(page.textContent).toContain("Spec change was Broken before The Office updated");
    expect(page.textContent).toContain("Changes Produce, which Document no longer had.");
    expect(page.textContent).toContain("Tasks can choose it once you save it.");
    expect(page.querySelector(".project-pipeline-facts")?.textContent).toContain(
      "Copied from Document ·",
    );
    expect(page.querySelector(".project-pipeline-facts")?.textContent).not.toContain(" on ");

    expect(buttonNamed("Discard").disabled).toBe(true);
    expect(buttonNamed("Save the Pipeline").disabled).toBe(false);
    await press("Save the Pipeline");
    expect(sent.saved).toEqual({ name: "Spec change", description: "", stages: [TESTS, WRITE] });
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
    await rendered(SPEC_CHANGE);
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
