import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConditionGroup, RoleCardOptions, Stage, StageProblem } from "@the-office/contracts";
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../toasts.tsx";
import type { StageCommandSource } from "../stage-commands.ts";
import { OfficeFlowEditor } from "./office-flow-editor.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IMPLEMENT: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Build it.",
  session: "fresh",
  budget: 100_000,
  place: { column: 0, row: 0 },
  routes: [{ to: "tests", condition: null }],
};
const TESTS: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  place: { column: 1, row: 0 },
  routes: [{ to: "publish", condition: null }],
};
const PUBLISH: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
  place: { column: 2, row: 0 },
  routes: [{ to: null, condition: null }],
};

const LIBRARY: StageCommandSource = {
  kind: "library",
  projects: [
    { name: "the-office", commands: [{ key: "docs-changed", name: "Docs changed" }] },
    { name: "notnullsoft", commands: [{ key: "lint", name: "Lint" }] },
  ],
};

/** The Stages as the editor last changed them. */
const seen: { stages: readonly Stage[] } = { stages: [] };

function Host({
  stages,
  problems,
  warnings,
}: {
  readonly stages: readonly Stage[];
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
}): ReactNode {
  const [draft, setDraft] = useState(stages);
  return (
    <OfficeFlowEditor
      stages={draft}
      onChange={(changed) => {
        seen.stages = changed;
        setDraft(changed);
      }}
      problems={problems}
      warnings={warnings}
      roles={[]}
      duties={[]}
      options={{} as RoleCardOptions}
      commands={LIBRARY}
    />
  );
}

async function rendered(
  stages: readonly Stage[] = [IMPLEMENT, TESTS, PUBLISH],
  problems: readonly StageProblem[] = [],
  warnings: readonly StageProblem[] = [],
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Host stages={stages} problems={problems} warnings={warnings} />
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  return page;
}

function wordsOf(element: Element): string {
  return [...element.childNodes]
    .filter(({ nodeName }) => nodeName !== "STYLE")
    .map(({ textContent }) => textContent ?? "")
    .join("")
    .trim();
}

function buttonNamed(name: string, within: ParentNode = document): HTMLButtonElement {
  const button = [...within.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || wordsOf(candidate) === name,
  );
  if (!button) throw new Error(`No button "${name}".`);
  return button;
}

async function press(name: string, within?: ParentNode): Promise<void> {
  const button = buttonNamed(name, within);
  await act(async () => button.click());
}

function selects(label: string): HTMLSelectElement[] {
  return [...document.querySelectorAll<HTMLSelectElement>(`select[aria-label="${label}"]`)];
}

async function choose(select: HTMLSelectElement | undefined, value: string): Promise<void> {
  if (!select) throw new Error("No such select.");
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function conditionOf(key: string, routeIndex = 0): ConditionGroup | null | undefined {
  return seen.stages.find((stage) => stage.key === key)?.routes?.[routeIndex]?.condition;
}

function routePanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('section[aria-label="Route"]');
  if (!panel) throw new Error("No route panel.");
  return panel;
}

/** Opens Tests' route to Publish and gives it a condition. */
async function openTestsRoute(): Promise<void> {
  await press("Tests");
  const row = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("→ Publish"),
  );
  if (!row) throw new Error("No route to Publish under Routes out.");
  await act(async () => row.click());
  const some = routePanel().querySelector<HTMLInputElement>('input[value="some"]');
  await act(async () => some?.click());
}

describe("the flow editor's condition builder", () => {
  beforeEach(() => {
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
      vi.fn(() => Promise.resolve(Response.json([]))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("opens a route's panel, and When these hold starts with the previous Stage ended Done", async () => {
    await rendered();
    await openTestsRoute();
    expect(routePanel().textContent).toContain("Route from Tests to Publish");
    expect(routePanel().textContent).toContain("1 of 1 route out of Tests");
    expect(conditionOf("tests")).toEqual({
      combine: "all",
      tests: [{ kind: "stage", stage: null, is: "done" }],
    });
    expect(selects("What it tests")[0]?.selectedOptions[0]?.textContent).toBe(
      "The previous Stage (Tests)",
    );
    expect(routePanel().textContent).toContain("Followed when Tests ended Done.");
  });

  it("builds a test of each kind a Stage has, ran N or more times with its Stepper", async () => {
    await rendered();
    await openTestsRoute();
    for (const is of ["failed", "skipped", "changed", "unchanged"] as const) {
      await choose(selects("Test")[0], is);
      expect(conditionOf("tests")?.tests[0]).toEqual({ kind: "stage", stage: null, is });
    }
    await choose(selects("Test")[0], "ran");
    expect(conditionOf("tests")?.tests[0]).toEqual({
      kind: "stage",
      stage: null,
      is: "ran",
      times: 2,
    });
    await press("Raise Times", routePanel());
    expect(conditionOf("tests")?.tests[0]).toMatchObject({ is: "ran", times: 3 });
    expect(routePanel().textContent).toContain("Tests ran 3 or more times");
  });

  it("tests an earlier Stage by its name and the Definition of Done", async () => {
    await rendered();
    await openTestsRoute();
    const subjects = [...(selects("What it tests")[0]?.options ?? [])].map(
      ({ textContent }) => textContent,
    );
    expect(subjects).toEqual([
      "The previous Stage (Tests)",
      "Implement",
      "The Definition of Done",
      "A Project command",
    ]);
    await choose(selects("What it tests")[0], "stage:implement");
    await choose(selects("Test")[0], "changed");
    await press("Add a test", routePanel());
    await choose(selects("What it tests")[1], "definitionOfDone");
    expect(conditionOf("tests")?.tests).toEqual([
      { kind: "stage", stage: "implement", is: "changed" },
      { kind: "definitionOfDone", is: "some-not-met" },
    ]);
    await choose(selects("Test")[1], "all-met");
    expect(conditionOf("tests")?.tests[1]).toEqual({ kind: "definitionOfDone", is: "all-met" });
    expect(routePanel().textContent).toContain(
      "Followed when Implement changed files and the Definition of Done is all Reported met.",
    );
  });

  it("joins the tests with or under Any of, nests a group and removes it", async () => {
    await rendered();
    await openTestsRoute();
    await press("Add a test", routePanel());
    await press("Any of", routePanel());
    expect(conditionOf("tests")?.combine).toBe("any");
    expect(routePanel().querySelector(".condition-join")?.textContent).toBe("or");
    await press("Add a group", routePanel());
    expect(conditionOf("tests")?.tests[2]).toEqual({
      combine: "all",
      tests: [{ kind: "stage", stage: null, is: "failed" }],
    });
    expect(routePanel().textContent).toContain(
      "Followed when Tests ended Done, Tests ended Done or Tests ended Failed.",
    );
    await press("Remove this group", routePanel());
    expect(conditionOf("tests")?.tests).toHaveLength(2);
    await press("Remove this test", routePanel());
    expect(conditionOf("tests")?.tests).toHaveLength(1);
  });

  it("runs a Project command, offering every key with the Projects that have it", async () => {
    await rendered();
    await openTestsRoute();
    await choose(selects("What it tests")[0], "command");
    const commands = selects("Project command")[0];
    expect([...(commands?.options ?? [])].map(({ textContent }) => textContent)).toEqual([
      "Choose a command…",
      "docs-changed · in the-office",
      "lint · in notnullsoft",
    ]);
    await choose(commands, "docs-changed");
    expect(conditionOf("tests")?.tests[0]).toEqual({ kind: "command", key: "docs-changed" });
    expect(routePanel().textContent).toContain("Holds when it exits 0.");
    expect(routePanel().textContent).toContain(
      "docs-changed runs as Tests ends, as a Script Stage's command runs",
    );
  });

  it("No condition takes the condition away", async () => {
    await rendered();
    await openTestsRoute();
    const none = routePanel().querySelector<HTMLInputElement>('input[value="none"]');
    await act(async () => none?.click());
    expect(conditionOf("tests")).toBeNull();
    expect(routePanel().querySelector(".condition-group")).toBeNull();
  });
});

describe("the flow editor's problems", () => {
  const COMMAND_PROBLEM: StageProblem = {
    stageKey: "tests",
    at: { kind: "route", routeIndex: 0, testPath: [0] },
    level: "problem",
    text: "The condition of Tests' route to Publish runs the Project command docs-changed, which notnullsoft doesn't have, and Full is notnullsoft's default.",
  };
  const LOOP_WARNING: StageProblem = {
    stageKey: "tests",
    at: { kind: "onFailure" },
    level: "warning",
    text: "Tests goes back to Implement on failure, but no path of routes leads from Implement to Tests.",
  };
  const WITH_COMMAND: Stage = {
    ...TESTS,
    routes: [
      {
        to: "publish",
        condition: { combine: "all", tests: [{ kind: "command", key: "docs-changed" }] },
      },
      { to: null, condition: null },
    ],
  };

  beforeEach(() => {
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
      vi.fn(() => Promise.resolve(Response.json([]))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("lists each problem as a link to its spot, and shows it on the select there", async () => {
    await rendered([IMPLEMENT, WITH_COMMAND, PUBLISH], [COMMAND_PROBLEM], [LOOP_WARNING]);
    expect(document.body.textContent).toContain("The Pipeline can't be saved yet");
    expect(document.body.textContent).toContain("Worth a look, though it doesn't hold Save");
    expect(document.querySelector('section[aria-label="Route"]')).toBeNull();

    await press(
      COMMAND_PROBLEM.text,
      document.querySelector('[aria-label="Problems"]') ?? document,
    );
    const select = selects("Project command")[0];
    expect(select?.value).toBe("docs-changed");
    // The panel's alert holds a route's own problems only: one on a test shows under its select.
    expect(routePanel().querySelector(".condition-test")?.textContent).toContain(
      COMMAND_PROBLEM.text,
    );

    await press(LOOP_WARNING.text, document.querySelector('[aria-label="Warnings"]') ?? document);
    const loop = document.querySelector('section[aria-label="On failure"]');
    expect(loop?.className).toContain("flow-panel-section--picked");
  });
});
