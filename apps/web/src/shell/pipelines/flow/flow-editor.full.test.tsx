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
      options={{} as RoleCardOptions}
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

  it("shows a locked Stage's lock and state, with no +, no Move or Remove, and its routes and loop read only", async () => {
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
    const loop = document.querySelector<HTMLFieldSetElement>(
      'section[aria-label="On failure"] fieldset',
    );
    expect([loop?.disabled, loop?.title]).toEqual([true, DONE]);

    await press("Tests");
    expect(buttonNamed("Move Tests later").disabled).toBe(false);
  });

  it("draws a route from a Stage that hasn't started into a locked one", async () => {
    await renderedTask({ publish: "Done" });
    await press("Implement");
    await press("Add a route");
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
