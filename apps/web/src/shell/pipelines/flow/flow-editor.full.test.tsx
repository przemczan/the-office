import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConditionGroup, RoleCardOptions, Stage, StageProblem } from "@the-office/contracts";
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../toasts.tsx";
import type { StageCommandSource } from "../stage-commands.ts";
import { OfficeFlowEditor } from "./office-flow-editor.tsx";
import { TaskFlowEditor } from "./task-flow-editor.tsx";

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
      // An Agent Stage's panel reads the Roles it may name.
      options={{ knownRoles: [] } as unknown as RoleCardOptions}
      commands={LIBRARY}
    />
  );
}

/** "Edit for this Task" with `started` Stages locked. */
function TaskHost({
  stages,
  started,
  problems,
}: {
  readonly stages: readonly Stage[];
  readonly started: ReadonlyMap<string, string>;
  readonly problems: readonly StageProblem[];
}): ReactNode {
  const [draft, setDraft] = useState(stages);
  return (
    <TaskFlowEditor
      stages={draft}
      onChange={(changed) => {
        seen.stages = changed;
        setDraft(changed);
      }}
      started={started}
      problems={problems}
      warnings={[]}
      roles={[]}
      duties={[]}
      // An Agent Stage's panel reads the Roles it may name.
      options={{ knownRoles: [] } as unknown as RoleCardOptions}
      commands={LIBRARY}
    />
  );
}

async function rendered(
  stages: readonly Stage[] = [IMPLEMENT, TESTS, PUBLISH],
  problems: readonly StageProblem[] = [],
  warnings: readonly StageProblem[] = [],
): Promise<HTMLElement> {
  return mounted(<Host stages={stages} problems={problems} warnings={warnings} />);
}

async function mounted(content: ReactNode): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{content}</ToastProvider>
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

/** Opens a route out of `stage` by its row in Routes out, the one leading to `target`. */
async function openRoute(stage: string, target: string): Promise<void> {
  await press(stage);
  const row = [...document.querySelectorAll(".flow-route-row-words")].find((button) =>
    button.textContent?.includes(`→ ${target}`),
  );
  if (!(row instanceof HTMLButtonElement))
    throw new Error(`No route to ${target} under Routes out.`);
  await act(async () => row.click());
}

/** Opens Tests' route to Publish and gives it a condition. */
async function openTestsRoute(): Promise<void> {
  await openRoute("Tests", "Publish");
  const holds = routePanel().querySelector<HTMLInputElement>('input[value="holds"]');
  await act(async () => holds?.click());
}

function routesOf(key: string): Stage["routes"] {
  return seen.stages.find((stage) => stage.key === key)?.routes;
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
    expect(routePanel().textContent).toContain("Followed when Tests ended Done, with no limit.");
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

  it("tests any other Stage by its name, later ones included, and the Definition of Done", async () => {
    await rendered();
    await openTestsRoute();
    const subjects = [...(selects("What it tests")[0]?.options ?? [])].map(
      ({ textContent }) => textContent,
    );
    expect(subjects).toEqual([
      "The previous Stage (Tests)",
      "Implement",
      "Publish",
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
      "Followed when Implement changed files and the Definition of Done is all Reported met, with no limit.",
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
      "Followed when Tests ended Done, Tests ended Done or Tests ended Failed, with no limit.",
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

  it("Otherwise takes the condition away", async () => {
    await rendered();
    await openTestsRoute();
    const otherwise = routePanel().querySelector<HTMLInputElement>('input[value="otherwise"]');
    await act(async () => otherwise?.click());
    expect(conditionOf("tests")).toBeNull();
    expect(routePanel().querySelector(".condition-group")).toBeNull();
  });

  it("offers When it fails on an Agent Stage's route only, as the ended-Failed test alone", async () => {
    await rendered();
    await openRoute("Tests", "Publish");
    expect(routePanel().querySelector('input[value="fails"]')).toBeNull();
    await openRoute("Implement", "Tests");
    const fails = routePanel().querySelector<HTMLInputElement>('input[value="fails"]');
    await act(async () => fails?.click());
    expect(conditionOf("implement")).toEqual({
      combine: "all",
      tests: [{ kind: "stage", stage: null, is: "failed" }],
    });
    expect(routePanel().textContent).toContain("When Implement ends Failed.");
    expect(routePanel().textContent).toContain("Followed when Implement fails, with no limit.");
  });
});

describe("the flow editor's routes and their limits", () => {
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

  it("offers every Stage as where a route goes, its own and earlier ones too, then End", async () => {
    await rendered();
    await openRoute("Tests", "Publish");
    const goesTo = routePanel().querySelector("select");
    expect([...(goesTo?.options ?? [])].map(({ textContent }) => textContent)).toEqual([
      "Implement",
      "Tests",
      "Publish",
      "End",
    ]);
    expect(routePanel().textContent).toContain(
      "Any Stage, this one or an earlier one to go back, or End to make Tests a final Stage.",
    );
  });

  it("starts a route turned back at most 3 times, and its limit is stepped or taken away", async () => {
    await rendered();
    await openRoute("Tests", "Publish");
    expect(routePanel().textContent).toContain("A route on: it starts at No limit.");
    await choose(routePanel().querySelector("select") ?? undefined, "implement");
    expect(routesOf("tests")).toEqual([{ to: "implement", condition: null, limit: 3 }]);
    expect(routePanel().textContent).toContain("A route back: it starts at 3.");
    expect(routePanel().textContent).toContain(
      "Always followed: it is Tests's one route out, at most 3 times in a walk; then you're asked (or the CTO first).",
    );
    await press("Raise times on the route to Implement", routePanel());
    expect(routesOf("tests")?.[0]?.limit).toBe(4);
    const noLimit = routePanel().querySelector<HTMLInputElement>(".flow-route-limit-none input");
    await act(async () => noLimit?.click());
    expect(routesOf("tests")?.[0]?.limit).toBeNull();
    expect(buttonNamed("Raise times on the route to Implement", routePanel()).disabled).toBe(true);
    await act(async () => noLimit?.click());
    expect(routesOf("tests")?.[0]?.limit).toBe(3);
  });

  it("lists each route out with its Goes to and At most, and adds a row by its form", async () => {
    await rendered();
    await press("Implement");
    const routesOut = document.querySelector<HTMLElement>('section[aria-label="Routes out"]');
    expect(
      routesOut?.querySelectorAll('[role="group"][aria-label="At most, route to Tests"]'),
    ).toHaveLength(1);
    expect(routesOut?.textContent).toContain(
      "A route back starts at 3, a route on at No limit. Every loop needs one route with a limit, so the walk always ends.",
    );
    await press("Add a route");
    // Otherwise is taken already: When it fails and When these hold are offered.
    expect(buttonsNamed("Otherwise")).toEqual([]);
    await press("When it fails");
    expect(routesOf("implement")).toEqual([
      {
        to: "publish",
        condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
        limit: null,
      },
      { to: "tests", condition: null },
    ]);
    await press("Implement");
    expect(document.querySelector('section[aria-label="Routes out"]')?.textContent).toContain(
      "When it fails→ Publish",
    );
    // When it fails stays first and Otherwise last.
    expect(buttonNamed("Move the route to Publish down").disabled).toBe(true);
    expect(buttonNamed("Move the route to Tests up").disabled).toBe(true);
  });

  it("draws a route back with its ≤N× mark, names its limit and counts the routes back", async () => {
    const back: Stage = {
      ...TESTS,
      routes: [
        {
          to: "implement",
          condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
          limit: 2,
        },
        { to: "publish", condition: null, limit: null },
      ],
    };
    await rendered([IMPLEMENT, back, PUBLISH]);
    expect(document.body.textContent).toContain("3 Stages · 4 routes · 1 route back");
    const marks = [...document.querySelectorAll("[data-flow-limit-mark]")].map((mark) => [
      mark.getAttribute("data-flow-limit-mark"),
      mark.textContent,
    ]);
    expect(marks).toEqual([["tests:0", "≤2×"]]);
    const row = buttonNamed("Route from Tests to Implement, at most 2 times");
    expect(row.textContent).toContain("≤2×");
    expect(document.querySelector('[aria-label="What the lines mean"]')?.textContent).toContain(
      "≤N×At most N times",
    );
  });
});

describe("the flow editor's problems", () => {
  const COMMAND_PROBLEM: StageProblem = {
    stageKey: "tests",
    at: { kind: "route", routeIndex: 0, testPath: [0] },
    level: "problem",
    text: "The condition of Tests' route to Publish runs the Project command docs-changed, which notnullsoft doesn't have, and Full is notnullsoft's default.",
  };
  const CONFLICT_WARNING: StageProblem = {
    stageKey: "publish",
    at: { kind: "stage" },
    level: "warning",
    text: "Publish: no route takes Conflict, so a conflict asks you.",
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
    await rendered([IMPLEMENT, WITH_COMMAND, PUBLISH], [COMMAND_PROBLEM], [CONFLICT_WARNING]);
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

    await press(
      CONFLICT_WARNING.text,
      document.querySelector('[aria-label="Warnings"]') ?? document,
    );
    expect(document.querySelector('section[aria-label="Publish"]')).not.toBeNull();
  });
});

const placesOf = (stages: readonly Stage[]) =>
  stages.map(({ key, place }) => [key, place?.column, place?.row]);

async function renderedTask(
  started: Readonly<Record<string, string>>,
  problems: readonly StageProblem[] = [],
): Promise<void> {
  seen.stages = [IMPLEMENT, TESTS, PUBLISH];
  await mounted(
    <TaskHost
      stages={[IMPLEMENT, TESTS, PUBLISH]}
      started={new Map(Object.entries(started))}
      problems={problems}
    />,
  );
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter(
    (button) => button.getAttribute("aria-label") === name || wordsOf(button) === name,
  );
}

describe("the flow editor for a Task, its started Stages locked", () => {
  const DONE = "Done: started, so it can't be changed";
  const ROUTES_LOCKED: StageProblem = {
    stageKey: "tests",
    at: { kind: "route", routeIndex: 0 },
    level: "problem",
    text: "Stage 2 · Tests: it has started, so its routes out stay as they are. To change where the walk goes, change the routes of a Stage that hasn't started.",
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

  it("shows a locked Stage's lock and state, with no +, no Move or Remove, and its routes read only", async () => {
    await renderedTask({ implement: "Done" });
    expect(
      document.querySelector(`[aria-label="Flow"] [role="img"][aria-label="${DONE}"]`),
    ).not.toBeNull();
    expect(document.querySelector('[data-flow-stage="implement"]')?.textContent).toContain("Done");
    expect(buttonsNamed("Draw a route from Implement")).toEqual([]);
    expect(buttonsNamed("Draw a route from Tests")).toHaveLength(1);

    await press("Implement");
    for (const direction of ["earlier", "later", "up", "down"]) {
      const move = buttonNamed(`Move Implement ${direction}`);
      expect(move.disabled).toBe(true);
      expect(move.title).toBe(DONE);
    }
    expect(buttonsNamed("More for Implement")).toEqual([]);
    const add = buttonNamed("Add a route");
    expect([add.disabled, add.title]).toEqual([true, DONE]);
    expect(buttonNamed("Remove the route to Tests").disabled).toBe(true);
    expect(
      document.querySelector<HTMLFieldSetElement>('section[aria-label="Implement"] fieldset')
        ?.disabled,
    ).toBe(true);
    const fields = document.querySelector<HTMLFieldSetElement>(
      'section[aria-label="Routes out"] fieldset',
    );
    expect([fields?.disabled, fields?.title]).toEqual([true, DONE]);

    await press("Tests");
    expect(buttonNamed("Move Tests later").disabled).toBe(false);
  });

  it("draws a route from a Stage that hasn't started into a locked one", async () => {
    await renderedTask({ publish: "Done" });
    await press("Implement");
    await press("Add a route");
    await press("When these hold");
    expect(seen.stages.find(({ key }) => key === "implement")?.routes?.map(({ to }) => to)).toEqual(
      ["publish", "tests"],
    );
  });

  it("adds a Stage after a locked one after the frozen columns, the locked Stages staying where they are", async () => {
    await renderedTask({ implement: "Done", tests: "Done" });
    await press("Implement");
    await press("Add a Stage");
    await press("Gate");
    expect(placesOf(seen.stages)).toEqual([
      ["implement", 0, 0],
      ["tests", 1, 0],
      ["gate", 2, 1],
      ["publish", 3, 0],
    ]);
  });

  it("links the check's problem on a locked Stage's route to the route, read only, with no Insert", async () => {
    await renderedTask({ tests: "Failed" }, [ROUTES_LOCKED]);
    await press(ROUTES_LOCKED.text, document.querySelector('[aria-label="Problems"]') ?? document);
    expect(routePanel().textContent).toContain("Route from Tests to Publish");
    const insert = buttonNamed("Insert a Stage on this route", routePanel());
    expect([insert.disabled, insert.title]).toEqual([
      true,
      "Failed: started, so it can't be changed",
    ]);
    expect(buttonNamed("Remove route", routePanel()).disabled).toBe(true);
    expect(routePanel().querySelector("fieldset")?.disabled).toBe(true);
  });
});

const IMPLEMENTATION_TEMPLATE = {
  id: "implementation",
  stage: { ...IMPLEMENT, key: "implementation", name: "Implementation", budget: 200_000 },
};

/** The Stage templates' list, and a template saved from a Stage answered as "saved-template". */
function templatesServed(url: string, init?: RequestInit): Response {
  if (!url.endsWith("/stage-templates")) return Response.json([]);
  if (init?.method === "POST") {
    const { stage } = JSON.parse(String(init.body)) as { stage: Stage };
    return Response.json({ id: "saved-template", stage });
  }
  const { place: _place, routes: _routes, ...stage } = IMPLEMENTATION_TEMPLATE.stage;
  return Response.json([{ ...IMPLEMENTATION_TEMPLATE, stage }]);
}

/** Lets the templates' list arrive. */
async function settled(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function stageKeyed(key: string): Stage | undefined {
  return seen.stages.find((stage) => stage.key === key);
}

function stagePanel(name: string): HTMLElement {
  const panel = document.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
  if (!panel) throw new Error(`No panel of ${name}.`);
  return panel;
}

describe("the flow editor's Stages linked to their Stage template", () => {
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
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(templatesServed(String(input), init)),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("links a Stage added from a template to a Pipeline's Stages, from Add a Stage and a route", async () => {
    await rendered();
    await press("Add a Stage");
    await settled();
    await press("Implementation");
    expect(stageKeyed("implementation")).toMatchObject({ templateId: "implementation" });

    await openTestsRoute();
    await press("Insert a Stage on this route", routePanel());
    await settled();
    // The menu's, as the canvas has a Stage of that name now.
    await press("Implementation", document.querySelector('[role="menu"]') ?? undefined);
    expect(stageKeyed("implementation-2")).toMatchObject({ templateId: "implementation" });
  });

  it("copies a template added to a Task's own Stages, never linked", async () => {
    await renderedTask({});
    await press("Add a Stage");
    await settled();
    await press("Implementation");
    expect(stageKeyed("implementation")).toBeDefined();
    expect(stageKeyed("implementation")).not.toHaveProperty("templateId");
  });

  it("shows how a linked Stage differs from its template, never by its name, takes a field back and unlinks", async () => {
    await rendered([{ ...IMPLEMENT, templateId: "implementation" }, TESTS, PUBLISH]);
    await press("Implement");
    await settled();
    expect(stagePanel("Implement").textContent).toContain(
      "Linked to the template Implementation · Differs in Budget",
    );

    await press("Take the template's");
    await press("Budget");
    expect(stageKeyed("implement")).toMatchObject({
      budget: 200_000,
      templateId: "implementation",
    });
    expect(stagePanel("Implement").textContent).toContain(
      "Linked to the template Implementation · Same as the template",
    );
    expect(buttonsNamed("Take the template's")).toEqual([]);

    await press("Unlink");
    expect(stageKeyed("implement")).not.toHaveProperty("templateId");
    expect(stageKeyed("implement")).toMatchObject({ budget: 200_000 });
    expect(stagePanel("Implement").textContent).not.toContain("Linked to the template");
  });

  it("links a Pipeline's Stage saved as a template to the new template, a Task's Stage not", async () => {
    await rendered();
    await press("Implement");
    await press("More for Implement");
    await press("Save Implement as a template");
    await settled();
    expect(stageKeyed("implement")).toMatchObject({ templateId: "saved-template" });
    document.body.replaceChildren();

    await renderedTask({});
    await press("Implement");
    await press("More for Implement");
    await press("Save Implement as a template");
    await settled();
    expect(stageKeyed("implement")).not.toHaveProperty("templateId");
  });

  it("opens with the Stage the address names picked", async () => {
    await mounted(
      <OfficeFlowEditor
        stages={[IMPLEMENT, TESTS, PUBLISH]}
        onChange={() => {}}
        problems={[]}
        warnings={[]}
        roles={[]}
        duties={[]}
        options={{ knownRoles: [] } as unknown as RoleCardOptions}
        pickedStage="tests"
      />,
    );
    expect(stagePanel("Tests")).toBeDefined();
  });
});

/** A control in the canvas's toolbar, by its label. */
function tool(name: string): HTMLButtonElement {
  const toolbar = document.body.querySelector('[role="toolbar"][aria-label="Canvas"]');
  const button = [...(toolbar?.querySelectorAll("button") ?? [])].find(
    (each) => each.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`No ${name} on the canvas.`);
  return button;
}

function pointer(target: Element, type: string, clientX: number): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY: 10 }),
    );
  });
}

describe("the flow editor's canvas, which pans and zooms", () => {
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

  it("is the only view of the Pipeline, with no View switch", async () => {
    await rendered();
    expect(document.querySelector('[aria-label="Flow"]')).not.toBeNull();
    expect(document.querySelector('[role="group"][aria-label="View"]')).toBeNull();
    expect(buttonsNamed("List")).toEqual([]);
  });

  it("opens at 100%, the largest, and steps out to 90% and back", async () => {
    await rendered();
    expect(tool("Zoom: 100%")).toBeTruthy();
    expect(tool("Zoom in").getAttribute("aria-disabled")).toBe("true");
    act(() => tool("Zoom out").click());
    expect(tool("Zoom: 90%")).toBeTruthy();
    act(() => tool("Zoom in").click());
    expect(tool("Zoom: 100%")).toBeTruthy();
  });

  it("shows only each Stage's name under 60%", async () => {
    const page = await rendered();
    expect(page.querySelector(".flow-canvas--names-only")).toBeNull();
    // 90, 75, 67, then 50%.
    for (let step = 0; step < 4; step += 1) act(() => tool("Zoom out").click());
    expect(tool("Zoom: 50%")).toBeTruthy();
    expect(page.querySelector(".flow-canvas--names-only")).not.toBeNull();
    expect(page.querySelector(".flow-canvas-route-row")).toBeNull();
  });

  it("gives the editor the whole window in full screen, and Escape brings it back", async () => {
    const page = await rendered();
    act(() => tool("Full screen").click());
    const fullScreen = document.body.querySelector('[role="dialog"][aria-modal="true"]');
    expect(fullScreen?.querySelector(".flow-editor--full-screen")).not.toBeNull();
    expect(page.querySelector(".flow-editor")).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(page.querySelector(".flow-editor:not(.flow-editor--full-screen)")).not.toBeNull();
  });

  it("says why a started Stage stays where it is when someone drags it", async () => {
    await renderedTask({ implement: "Done" });
    const card = document.body.querySelector('[data-flow-stage="implement"]');
    if (!card) throw new Error("No Implement on the canvas.");
    pointer(card, "pointerdown", 10);
    pointer(card, "pointermove", 40);
    pointer(card, "pointerup", 40);
    expect(document.body.querySelector(".flow-canvas-told")?.textContent).toBe(
      "Implement has started, so it stays where it is.",
    );
    expect(seen.stages.find(({ key }) => key === "implement")?.place).toEqual(IMPLEMENT.place);
  });
});
