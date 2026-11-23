import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  LinkedStage,
  OfficeWidePipeline,
  RoleCardOptions,
  Stage,
  StageTemplate,
  StageTemplateApplyResult,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleCardQueries, roleQueries } from "../../../api/people.ts";
import { pipelineQueries, stageTemplateQueries } from "../../../api/pipelines.ts";
import { PageHeadingProvider } from "../../../shell/page-heading.tsx";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { PipelinesSection } from "./pipelines-section.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PIPELINES = [
  { id: "full", name: "Full", description: "", stages: [] },
  { id: "quick", name: "Quick", description: "", stages: [] },
] as unknown as OfficeWidePipeline[];

const TEMPLATES: StageTemplate[] = [
  {
    id: "t-1",
    stage: {
      kind: "script",
      key: "tests",
      name: "Run the tests",
      optional: false,
      command: "test",
    },
  },
  {
    id: "t-2",
    stage: { kind: "gate", key: "review", name: "Look it over", optional: false },
  },
];

/** What the service holds for a test: the library's flags, a template's linked Stages, an apply. */
interface Served {
  readonly needingFixing?: readonly string[];
  readonly templates?: StageTemplate[];
  readonly linked?: readonly LinkedStage[];
  readonly applied?: StageTemplateApplyResult;
}

function answerOf(path: string, method: string, body: unknown, served: Served): unknown {
  if (path.endsWith("/check")) return { problems: [] };
  if (path.endsWith("/needs-fixing")) return { pipelineIds: served.needingFixing ?? [] };
  if (path.endsWith("/linked-stages")) return served.linked ?? [];
  if (path.endsWith("/apply")) return served.applied ?? { applied: 0, refused: [] };
  if (path.endsWith("/stage-templates")) return served.templates ?? TEMPLATES;
  if (path.endsWith("/pipelines")) return PIPELINES;
  if (method === "PUT") {
    return { id: path.split("/").at(-1), ...(body as { readonly stage: unknown }) };
  }
  return [];
}

async function rendered(address: string, served: Served = {}): Promise<HTMLElement> {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) =>
      Promise.resolve(
        Response.json(
          answerOf(
            String(input),
            init?.method ?? "GET",
            init?.body ? JSON.parse(String(init.body)) : undefined,
            served,
          ),
        ),
      ),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(pipelineQueries.list().queryKey, PIPELINES);
  queryClient.setQueryData(stageTemplateQueries.list().queryKey, served.templates ?? TEMPLATES);
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  queryClient.setQueryData(dutyQueries.list().queryKey, []);
  queryClient.setQueryData(roleCardQueries.options().queryKey, {
    knownRoles: [],
  } as unknown as RoleCardOptions);
  const root = createRootRoute();
  const section = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: PipelinesSection });
  const router = createRouter({
    routeTree: root.addChildren([
      section("settings/pipelines"),
      section("settings/pipelines/$pipelineId"),
      section("settings/pipelines/stage-templates"),
      section("settings/pipelines/stage-templates/$stageTemplateId"),
    ]),
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <PageHeadingProvider setPageHeading={() => undefined}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </PageHeadingProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

function tabs(page: HTMLElement): string[] {
  return [...(page.querySelector('[role="tablist"]')?.querySelectorAll('[role="tab"]') ?? [])].map(
    (tab) => tab.textContent ?? "",
  );
}

function selectedTab(page: HTMLElement): string {
  return (
    page.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]')?.textContent ?? ""
  );
}

describe("Settings › Pipelines as two tabs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("opens on Pipelines, listing only the Pipelines, with each tab's count", async () => {
    const page = await rendered("/settings/pipelines");
    expect(tabs(page)).toEqual(["Pipelines2", "Stage templates2"]);
    expect(selectedTab(page)).toContain("Pipelines");
    expect(page.textContent).toContain("Office-wide Pipelines");
    expect(page.textContent).not.toContain("Run the tests");
    expect(page.textContent).toContain("All Pipelines");
  });

  it("flags the Pipelines the library's one check names, sending no check for each row", async () => {
    const page = await rendered("/settings/pipelines/full", { needingFixing: ["quick"] });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const flagged = (pipelineId: string): boolean =>
      page.querySelector(
        `a[href="/settings/pipelines/${pipelineId}"] [aria-label="Needs fixing"]`,
      ) !== null;
    expect(flagged("quick")).toBe(true);
    expect(flagged("full")).toBe(false);
    const checked = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => String(input).endsWith("/pipelines/check"))
      .map(([, init]) => JSON.parse(String(init?.body)) as { readonly pipelineId?: string });
    expect(checked.map(({ pipelineId }) => pipelineId)).toEqual(["full"]);
  });

  it("opens the first Stage template when none is in the address", async () => {
    const page = await rendered("/settings/pipelines/stage-templates");
    expect(selectedTab(page)).toContain("Stage templates");
    expect(page.textContent).not.toContain("Office-wide Pipelines");
    expect(page.textContent).toContain("All Stage templates");
    const picked = page.querySelector('[aria-current="page"]');
    expect(picked?.textContent).toContain("Run the tests");
  });

  it("opens the Stage templates tab at a template's address, with that template open", async () => {
    const page = await rendered("/settings/pipelines/stage-templates/t-2");
    expect(selectedTab(page)).toContain("Stage templates");
    const picked = page.querySelector('[aria-current="page"]');
    expect(picked?.textContent).toContain("Look it over");
  });

  it("switches to the other tab's address when a tab is pressed", async () => {
    const page = await rendered("/settings/pipelines");
    const templatesTab = [...page.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) =>
      tab.textContent?.startsWith("Stage templates"),
    );
    await act(async () => {
      templatesTab?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(selectedTab(page)).toContain("Stage templates");
    expect(page.textContent).toContain("Run the tests");
  });
});

const REVIEW_STAGE: Extract<Stage, { kind: "agent" }> = {
  kind: "agent",
  key: "review",
  name: "Review",
  optional: false,
  role: "reviewer",
  session: "fresh",
  budget: 200_000,
  brief: "Review it.",
};

const REVIEW: StageTemplate = { id: "t-review", stage: REVIEW_STAGE };

const LINKED: LinkedStage[] = [
  {
    pipelineId: "full",
    pipelineName: "Full",
    projectId: null,
    stage: { ...REVIEW.stage, templateId: REVIEW.id },
  },
  {
    pipelineId: "pp-1",
    pipelineName: "Quick",
    projectId: "p-1",
    stage: {
      ...REVIEW_STAGE,
      key: "review-2",
      name: "Second look",
      brief: "Its own brief.",
      templateId: REVIEW.id,
    },
  },
];

async function settled(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function typeBrief(page: HTMLElement, text: string): Promise<void> {
  const brief = page.querySelector("textarea");
  if (!brief) throw new Error("No Brief.");
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(brief, text);
    brief.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // The check answers the draft.
  await settled();
}

async function rename(page: HTMLElement, name: string): Promise<void> {
  const field = page.querySelector<HTMLInputElement>('input[value="Review"]');
  if (!field) throw new Error("No name field.");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(field, name);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settled();
}

/** An element's words, without the spinner's style a Button holds. */
function wordsOf(element: Element): string {
  return [...element.childNodes]
    .filter((node) => node.nodeName !== "STYLE")
    .map((node) => (node instanceof Element ? wordsOf(node) : (node.textContent ?? "")))
    .join("")
    .trim();
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
  await settled();
}

function sent(method: string, pathEnd: string): unknown[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([input, init]) => (init?.method ?? "GET") === method && String(input).endsWith(pathEnd),
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as unknown);
}

function ticks(): Record<string, boolean> {
  return Object.fromEntries(
    [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')].map(
      (box) => [box.getAttribute("aria-label") ?? "", box.checked],
    ),
  );
}

/** The Review template open in Settings, with its two linked Stages. */
function opened(served: Served = {}): Promise<HTMLElement> {
  return rendered(`/settings/pipelines/stage-templates/${REVIEW.id}`, {
    templates: [REVIEW],
    linked: LINKED,
    ...served,
  });
}

describe("Settings › Stage templates with linked Stages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("lists each linked Stage with its Pipeline, how it differs and a link to it", async () => {
    const page = await opened();
    await settled();

    expect(page.textContent).toContain("Linked Stages· 2");
    const rows = [...page.querySelectorAll(".linked-stage")];
    expect(rows.map((row) => row.textContent)).toEqual([
      "ReviewFull · office-wideSame as the template",
      "Second lookp-1's QuickDiffers in Brief",
    ]);
    expect(rows.map((row) => row.querySelector("a")?.getAttribute("href"))).toEqual([
      "/settings/pipelines/full?stage=review",
      "/projects/p-1/pipelines/pp-1?stage=review-2",
    ]);
  });

  it("says when no Stage is linked", async () => {
    const page = await opened({ linked: [] });
    await settled();

    expect(page.textContent).toContain("Linked Stages· 0");
    expect(page.textContent).toContain("No Stage is linked to it.");
  });

  it("asks which linked Stages get an edit, ticking those that don't have their own of it", async () => {
    const page = await opened({
      applied: {
        applied: 1,
        refused: [
          { pipelineId: "pp-1", pipelineName: "Quick", projectId: "p-1", reasons: ["No route."] },
        ],
      },
    });
    await settled();
    await typeBrief(page, "Review it closely.");
    await press("Save the template");

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "This edit changes Brief.",
    );
    expect(ticks()).toEqual({
      "Apply to Review in Full · office-wide": true,
      "Apply to Second look in p-1's Quick": false,
    });
    expect(document.body.textContent).toContain("Its own Brief is replaced");
    expect(sent("PUT", `/stage-templates/${REVIEW.id}`)).toEqual([]);

    await press("Save and apply to 1 Stage");

    expect(sent("PUT", `/stage-templates/${REVIEW.id}`)).toEqual([
      { stage: { ...REVIEW.stage, brief: "Review it closely." } },
    ]);
    expect(sent("POST", "/apply")).toEqual([
      { fields: ["brief"], stages: [{ pipelineId: "full", stageKey: "review" }] },
    ]);
    expect(document.body.textContent).toContain("Review saved and applied to 1 Stage.");
    expect(document.body.textContent).toContain("Some Pipelines kept their Stages as they were");
    expect(document.body.textContent).toContain("p-1's Quick: No route.");
  });

  it("saves the template only when asked, applying nothing", async () => {
    const page = await opened();
    await settled();
    await typeBrief(page, "Review it closely.");
    await press("Save the template");
    await press("Save the template only");

    expect(sent("PUT", `/stage-templates/${REVIEW.id}`)).toHaveLength(1);
    expect(sent("POST", "/apply")).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain(
      "Review saved. Its linked Stages keep their fields.",
    );
  });

  it("saves an edit of only the name at once", async () => {
    const page = await opened();
    await settled();
    await rename(page, "Code review");
    await press("Save the template");

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(sent("PUT", `/stage-templates/${REVIEW.id}`)).toEqual([
      { stage: { ...REVIEW.stage, name: "Code review" } },
    ]);
    expect(document.body.textContent).toContain("Code review saved.");
  });

  it("confirms Remove with the count of linked Stages it unlinks", async () => {
    await opened();
    await settled();
    await press("Remove");

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Its 2 Stages linked to it keep their fields and are unlinked.",
    );
  });
});
