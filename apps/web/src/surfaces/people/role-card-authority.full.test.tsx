import type { Role, RoleCardOptions, SavedRoleCard } from "@the-office/contracts";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AUTHORITY_AREAS, NEVER_EVERYWHERE } from "../../shell/authority.fixtures.ts";
import { AuthorityFields, AuthorityView } from "./role-card-authority.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = {
  knownRoles: [
    { key: "devops", title: "Devops" },
    { key: "developer", title: "Developer" },
  ],
  authority: AUTHORITY_AREAS,
  fromScratchAuthority: NEVER_EVERYWHERE,
} as unknown as RoleCardOptions;

/** The Developer preset's defaults in the fixture's areas. */
const PRESET = {
  ...NEVER_EVERYWHERE,
  taskRecords: {
    kind: "own-and-others",
    own: { kind: "allowed" },
    others: { kind: "ask-me" },
  },
  runInstalls: { kind: "consult", role: "devops" },
} as const;

const CARD = { name: "Ada", title: "Developer", authority: {} } as unknown as SavedRoleCard;

function roleWith(more: Partial<Role> = {}): Role {
  return {
    key: "developer",
    card: CARD,
    presetAuthority: PRESET,
    builtIn: false,
    askingYouUntilHired: ["runInstalls"],
    ...more,
  } as unknown as Role;
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function rendered(shown: ReactNode): HTMLElement {
  const page = document.createElement("div");
  document.body.append(page);
  act(() => {
    root = createRoot(page);
    root.render(shown);
  });
  return page;
}

function linesOf(list: Element | null): string[] {
  return [...(list?.querySelectorAll("li") ?? [])].map(({ textContent }) => textContent);
}

describe("the Role card's Authority", () => {
  it("shows each area's value, the rows that differ or are capped, then the followed rows", () => {
    const page = rendered(<AuthorityView role={roleWith()} options={OPTIONS} />);

    expect(linesOf(page.querySelector('[aria-label="Work"]'))).toEqual([
      "WorkPreset default (Never)",
      "Task recordsPreset default (Own: Allowed · Others': Ask me)",
      "Continue at a Gate on own workPreset default (Never)Proposal, Ask me or Never only: the trust anchor",
    ]);
    expect(linesOf(page.querySelectorAll(".role-card-authority")[2] ?? null)).toEqual([
      "Run installsPreset default (Consult Devops)Asks you until the Role is hiredFollowed by the Agentenforced on run_environment_check",
      "Publish outside the PipelinePreset default (Never)Followed by the Agent",
      "Approve held calls and apply ProposalsPreset default (Never)Proposal, Ask me or Never only: the trust anchor",
    ]);
  });

  it("shows a set value plainly, and the area's value as most of its groups have it", () => {
    const role = roleWith({
      card: {
        ...CARD,
        authority: { movingWork: { kind: "ask-me" }, gatesAndRuns: { kind: "ask-me" } },
      },
    });
    const page = rendered(<AuthorityView role={role} options={OPTIONS} />);

    // Ask me twice, Never once and the pair once: the area reads Ask me, set.
    expect(linesOf(page.querySelector('[aria-label="Work"]'))).toEqual([
      "WorkAsk me",
      "Task recordsPreset default (Own: Allowed · Others': Ask me)",
      "Continue at a Gate on own workPreset default (Never)Proposal, Ask me or Never only: the trust anchor",
    ]);
  });

  it("reads the Caretaker's fixed Authority plainly", () => {
    const page = rendered(
      <AuthorityView
        role={roleWith({ builtIn: true, askingYouUntilHired: [] })}
        options={OPTIONS}
      />,
    );

    expect(linesOf(page.querySelector('[aria-label="Work"]'))[0]).toBe("WorkNever");
    expect(page.textContent).toContain("Built in: fixed for the Caretaker.");
  });
});

/** The form's Authority over a draft it keeps, which `saved` reads after each change. */
function authorityForm(card: SavedRoleCard, fixed = false) {
  let latest = card;
  function Form(): ReactNode {
    const [draft, setDraft] = useState(card);
    return (
      <AuthorityFields
        draft={draft}
        defaults={PRESET}
        options={OPTIONS}
        ownRoleKey="developer"
        hiredRoles={new Set(["developer"])}
        fixed={fixed}
        change={(fields) => {
          latest = { ...draft, ...fields };
          setDraft(latest);
        }}
      />
    );
  }
  const page = rendered(<Form />);
  return { page, saved: () => latest };
}

function selectLabelled(within: Element, label: string): HTMLSelectElement {
  const found = [...within.querySelectorAll("label")].find(
    ({ textContent }) => textContent.trim() === label,
  );
  const control = found && document.getElementById(found.htmlFor);
  if (!(control instanceof HTMLSelectElement)) throw new Error(`No select ${label}.`);
  return control;
}

function fieldOf(page: HTMLElement, label: string): HTMLElement {
  const field = [...page.querySelectorAll<HTMLElement>(".role-card-authority-field")].find(
    (each) =>
      each.getAttribute("aria-label") === label ||
      [...each.querySelectorAll("label")].some(({ textContent }) => textContent.trim() === label),
  );
  if (!field) throw new Error(`No row ${label}.`);
  return field;
}

function pick(control: HTMLSelectElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
      control,
      value,
    );
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function optionLabels(control: HTMLSelectElement): string[] {
  return [...control.options].map(({ textContent }) => textContent);
}

describe("the Role card form's Authority", () => {
  it("offers each row its values, a capped row only Proposal, Ask me and Never", () => {
    const { page } = authorityForm(CARD);

    expect(optionLabels(selectLabelled(page, "Moving work"))).toEqual([
      "Allowed",
      "Consult Devops",
      "Ask me",
      "Proposal",
      "Never",
    ]);
    expect(optionLabels(selectLabelled(page, "Change Roles"))).toEqual([
      "Proposal",
      "Ask me",
      "Never",
    ]);
    expect(fieldOf(page, "Change Roles").textContent).toContain(
      "Proposal, Ask me or Never only: the trust anchor",
    );
    expect(fieldOf(page, "Run installs").textContent).toContain(
      "Followed by the Agent, enforced on run_environment_check. Asks you until the Role is hired.",
    );
    expect(fieldOf(page, "Moving work").textContent).toContain("Preset default (Never)");
  });

  it("sets a row, resets it to the preset's default, and keeps a value equal to it unset", () => {
    const { page, saved } = authorityForm(CARD);

    pick(selectLabelled(page, "Moving work"), "ask-me");
    expect(saved().authority).toEqual({ movingWork: { kind: "ask-me" } });
    const reset = [...fieldOf(page, "Moving work").querySelectorAll("button")].find(
      ({ textContent }) => textContent.includes("Reset to the preset's default"),
    );
    act(() => reset?.click());
    expect(saved().authority).toEqual({});
    expect(fieldOf(page, "Moving work").textContent).toContain("Preset default (Never)");

    pick(selectLabelled(page, "Gates and runs"), "consult:devops");
    pick(selectLabelled(page, "Gates and runs"), "never");
    expect(saved().authority).toEqual({});
  });

  it("sets a record's own and others' values apart, and a pair picked equal as one value", () => {
    const { page, saved } = authorityForm(CARD);
    const records = fieldOf(page, "Task records");

    pick(selectLabelled(records, "Others'"), "never");
    expect(saved().authority).toEqual({
      taskRecords: { kind: "own-and-others", own: { kind: "allowed" }, others: { kind: "never" } },
    });
    pick(selectLabelled(records, "Own"), "never");
    expect(saved().authority).toEqual({ taskRecords: { kind: "never" } });
  });

  it("shows the Caretaker's Authority disabled, with no Reset", () => {
    const { page } = authorityForm(CARD, true);

    expect(selectLabelled(page, "Moving work").disabled).toBe(true);
    expect(page.textContent).not.toContain("Preset default");
    expect(page.textContent).toContain("Built in: fixed for the Caretaker.");
  });
});
