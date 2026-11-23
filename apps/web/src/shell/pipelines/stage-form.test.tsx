import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Duty, Role, RoleCardOptions, Stage } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stageContextLimitsQuery } from "../../api/conversations.ts";
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  // The Office defaults as Settings › Office limits has them, changed from the shipped ones.
  queryClient.setQueryData(stageContextLimitsQuery().queryKey, {
    stageContextLimits: { soft: 120_000, hard: 200_000 },
  });
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <StageForm
          stages={[stage]}
          index={0}
          onChange={(stages) => changed.push(stages)}
          roles={[developer]}
          duties={duties}
          options={options}
        />
      </QueryClientProvider>,
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

/** Picks the option reading `option` in the Select labelled `label`. */
function choose(label: string, option: string): void {
  const field = [...page.querySelectorAll("label")].find(({ textContent }) =>
    textContent?.startsWith(label),
  );
  const select = page.querySelector<HTMLSelectElement>(`select[id="${field?.htmlFor ?? ""}"]`);
  if (!select) throw new Error(`No Select labelled ${label}.`);
  act(() => {
    select.value = [...select.options].find(({ text }) => text === option)?.value ?? "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

describe("Context limits", () => {
  it("names the Office defaults it takes while the Stage leaves them out", () => {
    rendered(implement);
    expect(page.textContent).toContain("Office default (120k / 200k)");
    expect(page.textContent).not.toContain("Soft limit");
  });

  it("gives the Stage its own limits, starting at the Office defaults", () => {
    const changed = rendered(implement);
    choose("Context limits", "Set for this Stage");
    expect(changed.at(-1)?.[0]).toMatchObject({
      contextLimits: { kind: "set", limits: { soft: 120_000, hard: 200_000 } },
    });
  });

  it("steps the Stage's own limits, never under the soft minimum", () => {
    const changed = rendered({
      ...implement,
      contextLimits: { kind: "set", limits: { soft: 50_000, hard: 70_000 } },
    });
    expect(button("Lower the soft limit")?.disabled).toBe(true);
    expect(button("Lower the hard limit")?.disabled).toBe(true);
    act(() => button("Raise the hard limit")?.click());
    expect(changed.at(-1)?.[0]).toMatchObject({
      contextLimits: { kind: "set", limits: { soft: 50_000, hard: 75_000 } },
    });
  });

  it("sets No limit", () => {
    const changed = rendered(implement);
    choose("Context limits", "No limit");
    expect(changed.at(-1)?.[0]).toMatchObject({ contextLimits: { kind: "none" } });
  });

  it("goes back to the Office defaults by leaving the limits out", () => {
    const changed = rendered({ ...implement, contextLimits: { kind: "none" } });
    choose("Context limits", "Office default (120k / 200k)");
    const [stage] = changed.at(-1) ?? [];
    expect(stage).toBeDefined();
    expect(stage).not.toHaveProperty("contextLimits");
  });
});

describe("Effort", () => {
  it("leaves the effort to the person until the Stage sets its own, and back", () => {
    const changed = rendered({ ...implement, effort: "high" });
    const field = [...page.querySelectorAll("label")].find(
      ({ textContent }) => textContent === "Effort",
    );
    const select = page.querySelector<HTMLSelectElement>(`select[id="${field?.htmlFor ?? ""}"]`);
    expect(select?.options[0]?.text).toBe("Person's effort");
    expect(select?.value).toBe("high");
    choose("Effort", "Person's effort");
    const [stage] = changed.at(-1) ?? [];
    expect(stage).toBeDefined();
    expect(stage?.kind === "agent" ? stage.effort : "not an Agent Stage").toBeUndefined();
  });
});

function mergeBaseFirst(): HTMLElement | null {
  const label = [...page.querySelectorAll("label")].find(({ textContent }) =>
    textContent?.startsWith("Merge the base first"),
  );
  return label?.querySelector<HTMLElement>('[role="checkbox"]') ?? null;
}

describe("Merge the base first", () => {
  it("is off for a Stage that leaves it out, and is set, then left out again", () => {
    const changed = rendered(implement);
    expect(mergeBaseFirst()?.getAttribute("aria-checked")).toBe("false");
    act(() => mergeBaseFirst()?.click());
    expect(changed.at(-1)?.[0]).toEqual({ ...implement, mergeBaseFirst: true });

    const unset = rendered({ ...implement, mergeBaseFirst: true });
    expect(mergeBaseFirst()?.getAttribute("aria-checked")).toBe("true");
    act(() => mergeBaseFirst()?.click());
    expect(unset.at(-1)?.[0]).toEqual(implement);
  });
});
