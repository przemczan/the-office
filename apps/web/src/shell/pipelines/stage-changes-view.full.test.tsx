import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  BrokenReason,
  BuiltStage,
  Role,
  RoleCardOptions,
  Stage,
  StageChange,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stageTemplateQueries } from "../../api/pipelines.ts";
import { StageChangesView } from "./stage-changes-view.tsx";

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
};
const REVIEW: Stage = {
  kind: "agent",
  key: "review",
  name: "Review & fix",
  optional: false,
  role: "developer",
  brief: "Review it.",
  session: "fresh",
  budget: 200_000,
};
const LINUX: Stage = {
  kind: "script",
  key: "verify-on-linux",
  name: "Verify on Linux",
  optional: false,
  command: "verify-linux",
};
const PUBLISH: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};

const INSERT: StageChange = {
  kind: "insert-after",
  stageKey: "review",
  stageName: "Review & fix",
  stage: LINUX,
};
const CHANGE: StageChange = {
  kind: "change",
  stageKey: "review",
  stageName: "Review & fix",
  fields: { brief: "Read closely." },
};
const REMOVE: StageChange = { kind: "remove", stageKey: "publish", stageName: "Publish" };

const ROWS: BuiltStage[] = [
  { stage: TESTS, origin: "base", stageChangeIndexes: [], baseStage: TESTS, changedFields: [] },
  {
    stage: { ...REVIEW, brief: "Read closely." },
    origin: "changed",
    stageChangeIndexes: [1],
    baseStage: REVIEW,
    changedFields: ["brief"],
  },
  { stage: LINUX, origin: "inserted", stageChangeIndexes: [0], baseStage: null, changedFields: [] },
  {
    stage: PUBLISH,
    origin: "removed",
    stageChangeIndexes: [2],
    baseStage: PUBLISH,
    changedFields: [],
  },
];

const ROLES = [
  { key: "developer", letGoAt: null, card: { name: "Jim", taskLimit: 1 } },
] as unknown as Role[];

function shown({
  rows = ROWS,
  stageChanges = [INSERT, CHANGE, REMOVE],
  broken = [],
  onChange,
}: {
  readonly rows?: readonly BuiltStage[];
  readonly stageChanges?: readonly StageChange[];
  readonly broken?: readonly BrokenReason[];
  readonly onChange?: (stageChanges: readonly StageChange[]) => void;
}): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(stageTemplateQueries.list().queryKey, []);
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <StageChangesView
          projectName="the-office"
          baseName="Full"
          built={{ rows, broken }}
          stageChanges={stageChanges}
          onChange={onChange}
          roles={ROLES}
          options={{} as RoleCardOptions}
          commands={{
            kind: "project",
            publishing: "merge into main",
            commands: [
              { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
              { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
              {
                key: "verify-linux",
                name: "Verify on Linux",
                kind: "test",
                commandLine: "npm run verify:linux",
              },
            ],
          }}
        />
      </QueryClientProvider>,
    ),
  );
  return page;
}

function row(page: HTMLElement, name: string): HTMLElement {
  const found = [...page.querySelectorAll<HTMLElement>("li[aria-label]")].find(
    (item) => item.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`No row named ${name}.`);
  return found;
}

function press(within: HTMLElement, label: string): void {
  const button = [...within.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label ||
      [...candidate.childNodes].some(({ textContent }) => textContent === label),
  );
  if (!button) throw new Error(`No button "${label}".`);
  act(() => button.click());
}

function choose(select: HTMLSelectElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("what the Project gets", () => {
  afterEach(() => document.body.replaceChildren());

  it("marks each row with where its Stage comes from, a removed one kept in place", () => {
    const page = shown({ onChange: vi.fn<(stageChanges: readonly StageChange[]) => void>() });
    expect(row(page, "Tests").textContent).toContain("From Full");
    expect(row(page, "Review & fix").textContent).toContain("Changed: Brief");
    expect(row(page, "Verify on Linux").textContent).toContain("Inserted after Review & fix");
    expect(row(page, "Publish").className).toContain("removed");
    expect(row(page, "Publish").textContent).toContain("Removed");
    expect(page.textContent).toContain("3 Stages: Full's 3, with 3 Stage changes");
  });

  it("shows each field a Change gives beside the base Pipeline's value, and sets one back", () => {
    const onChange = vi.fn<(stageChanges: readonly StageChange[]) => void>();
    const page = shown({ onChange });
    const review = row(page, "Review & fix");
    press(review, "Show what changed");
    const compare = review.querySelector('[role="table"]');
    expect(compare?.textContent).toContain("Full has");
    expect(compare?.querySelector(".stage-changes-was")?.textContent).toBe("Review it.");
    expect(compare?.querySelector(".stage-changes-now")?.textContent).toBe("Read closely.");
    press(review, "Set Brief back to Full's");
    expect(onChange).toHaveBeenLastCalledWith([INSERT, REMOVE]);
  });

  it("undoes each Stage change on its own", () => {
    const onChange = vi.fn<(stageChanges: readonly StageChange[]) => void>();
    const page = shown({ onChange });
    press(row(page, "Publish"), "Undo: put Full's Publish back");
    expect(onChange).toHaveBeenLastCalledWith([INSERT, CHANGE]);
    press(row(page, "Verify on Linux"), "Undo: take Verify on Linux out");
    expect(onChange).toHaveBeenLastCalledWith([CHANGE, REMOVE]);
  });

  it("makes a Change of an edited Stage from the base Pipeline, checked against the Project's commands", () => {
    const onChange = vi.fn<(stageChanges: readonly StageChange[]) => void>();
    const page = shown({ onChange });
    press(row(page, "Tests"), "Edit Tests");
    const command = row(page, "Tests").querySelector<HTMLSelectElement>("select");
    if (!command) throw new Error("No Project command to choose.");
    // The Project's own commands, and Publish; no other Project's.
    expect([...command.options].map(({ value }) => value)).toEqual([
      "test",
      "lint",
      "verify-linux",
      "publish",
    ]);
    choose(command, "lint");
    expect(onChange).toHaveBeenLastCalledWith([
      INSERT,
      CHANGE,
      REMOVE,
      { kind: "change", stageKey: "tests", stageName: "Tests", fields: { command: "lint" } },
    ]);
  });

  it("says why a Broken Stage change doesn't apply, and applies it to another Stage", () => {
    const gone: StageChange = {
      kind: "change",
      stageKey: "produce",
      stageName: "Produce",
      fields: { brief: "Write." },
    };
    const onChange = vi.fn<(stageChanges: readonly StageChange[]) => void>();
    const page = shown({
      rows: ROWS.slice(0, 1),
      stageChanges: [gone],
      broken: [
        {
          stageChangeIndex: 0,
          stageIndex: null,
          stageKey: "produce",
          text: "Changes Produce, which Full no longer has.",
        },
      ],
      onChange,
    });
    const block = page.querySelector<HTMLElement>('[role="group"]');
    expect(block?.getAttribute("aria-label")).toBe("1 Stage change doesn't apply to Full");
    expect(block?.textContent).toContain("Changes Produce, which Full no longer has.");
    const applyTo = block?.querySelector<HTMLSelectElement>("select");
    if (!applyTo) throw new Error("No Stage to apply it to.");
    choose(applyTo, "tests");
    expect(onChange).toHaveBeenLastCalledWith([{ ...gone, stageKey: "tests", stageName: "Tests" }]);
  });

  it("only shows, read-only: no Edit, Undo, Insert or fix", () => {
    const page = shown({
      broken: [
        {
          stageChangeIndex: 0,
          stageIndex: null,
          stageKey: "review",
          text: "Inserts Verify on Linux after Review & fix, which Full no longer has.",
        },
      ],
    });
    expect(page.textContent).toContain("Inserted after Review & fix");
    const labels = [...page.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );
    expect(labels.some((label) => /^(Edit|Undo|Insert|Remove this)/.test(label ?? ""))).toBe(false);
    expect(page.querySelector("select")).toBeNull();
  });
});
