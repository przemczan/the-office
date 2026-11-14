import type { Duty, Role, RoleCardOptions, Stage } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StageForm } from "./stage-form.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver; the list's placing only needs it to exist.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Implement the Plan.",
  session: "fresh",
  budget: 250_000,
};

const developer = {
  key: "developer",
  letGoAt: null,
  card: {
    name: "Ada",
    title: "Developer",
    taskLimit: 2,
    permissionProfile: { edit: true, run: "anything", web: true, mcpTools: {} },
  },
  mcpServers: [],
} as unknown as Role;

const duties = [
  { key: "plans", holder: null },
  { key: "implements", holder: { roleKey: "developer", name: "Ada", title: "Developer" } },
  { key: "reviews", holder: null },
  { key: "onboards-projects", holder: null },
  { key: "shapes-initiatives", holder: null },
] as Duty[];

const options = { knownRoles: [] } as unknown as RoleCardOptions;

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => root.unmount());
  page.remove();
  document.body.innerHTML = "";
});

/** Renders the form for `stage`, keeping each list of Stages it answers in `changed`. */
function rendered(stage: Stage, changed: (readonly Stage[])[] = []): (readonly Stage[])[] {
  act(() =>
    root.render(
      <StageForm
        stages={[stage]}
        index={0}
        onChange={(stages) => changed.push(stages)}
        roles={[developer]}
        duties={duties}
        options={options}
      />,
    ),
  );
  return changed;
}

/** Opens "Who works it" and answers its groups, each with its options' labels. */
function whoWorksGroups(): Record<string, string[]> {
  const trigger = page.querySelector<HTMLButtonElement>("[role=combobox]");
  act(() => trigger?.click());
  const groups = [...document.querySelectorAll('[role="listbox"] [role="group"]')];
  return Object.fromEntries(
    groups.map((group) => [
      group.querySelector(".grouped-select-group")?.textContent ?? "",
      [...group.querySelectorAll(".grouped-select-label")].map((label) => label.textContent ?? ""),
    ]),
  );
}

function optionNamed(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.querySelector(".grouped-select-label")?.textContent === label,
  );
}

describe("Who works it", () => {
  it("offers the Pipeline duties with their holders, then the people with a Task limit", () => {
    rendered(implement);
    expect(whoWorksGroups()).toEqual({
      Duties: [
        "Plans · nobody holds it",
        "Implements · Ada · Developer",
        "Reviews · nobody holds it",
        "Onboards and repairs Projects · nobody holds it",
      ],
      People: ["Ada · Developer"],
    });
  });

  it("gives the Stage a duty in place of its Role", () => {
    const changed = rendered(implement);
    whoWorksGroups();
    act(() => optionNamed("Implements · Ada · Developer")?.click());
    const [stage] = changed.at(-1) ?? [];
    expect(stage).toMatchObject({ kind: "agent", duty: "implements" });
    expect(stage).not.toHaveProperty("role");
  });

  it("keeps a stored Stage's other duty listed by its label", () => {
    rendered({ ...implement, role: undefined, duty: "shapes-initiatives" });
    expect(whoWorksGroups().Duties).toContain("Shapes Initiatives · nobody holds it");
    expect(page.querySelector("[role=combobox]")?.textContent).toBe(
      "Shapes Initiatives · nobody holds it",
    );
  });
});
