import type { ProjectEnginePerson } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buttonNamed, shownText, until } from "../../shell/page.fixtures.tsx";
import {
  PUT_ENGINE,
  click,
  closeCard,
  engineCard,
  groupOf,
  optionLabels,
  pick,
  projectWith,
  refused,
  savedAs,
  selectIn,
  shownDialog,
} from "./engine-block.fixtures.tsx";

const ON_WORK = { engineType: "claude-code", engineId: "work" } as const;

const DWIGHT: ProjectEnginePerson = {
  roleKey: "developer",
  engineSettings: {
    "claude-code": { model: "claude-opus-5-5", effort: null },
    // A type with no engine listed: not shown, and kept.
    "gemini-cli": { model: "pro", effort: null },
  },
};

const RITA: ProjectEnginePerson = {
  roleKey: "reviewer",
  engineSettings: { codex: { model: null, effort: "low" } },
};

function perPerson(page: HTMLElement): HTMLElement {
  return groupOf(page, "Model and effort per person");
}

function headers(page: HTMLElement): string[] {
  return [...perPerson(page).querySelectorAll("th")].map((cell) => shownText(cell));
}

function rowOf(page: HTMLElement, name: string): HTMLElement {
  const row = [...perPerson(page).querySelectorAll<HTMLElement>("tbody tr")].find((candidate) =>
    shownText(candidate).includes(name),
  );
  if (!row) throw new Error(`There is no row for ${name}.`);
  return row;
}

function cells(row: HTMLElement): string[] {
  return [...row.querySelectorAll("td")].map((cell) => shownText(cell));
}

function sentPeople(sent: { request: string; body: unknown }[]): unknown {
  return (sent.find(({ request }) => request === PUT_ENGINE)?.body as { people?: unknown })?.people;
}

describe("the Engine card's Model and effort per person", () => {
  afterEach(closeCard);

  it("says nobody has a setting while the table is empty", async () => {
    const { page } = await engineCard(projectWith({}));

    expect(shownText(perPerson(page))).toContain(
      "Nobody has a setting of their own here, so each person works with their Role card's.",
    );
    expect(perPerson(page).querySelector("table")).toBeNull();
  });

  it("shows a row per person and a column per listed type, the Project's first", async () => {
    const { page } = await engineCard(projectWith({ default: ON_WORK, people: [DWIGHT, RITA] }));

    expect(headers(page).slice(0, 3)).toEqual(["Person", "Claude Code", "Codex"]);
    expect(cells(rowOf(page, "Dwight")).slice(1, 3)).toEqual([
      "Opus 5.5 · Person's setting",
      "Person's setting",
    ]);
    expect(cells(rowOf(page, "Rita")).slice(1, 3)).toEqual([
      "Person's setting",
      "Person's setting · Low",
    ]);
    expect(shownText(perPerson(page))).not.toContain("Gemini");
  });

  it("dims the forced type's column, its head saying so", async () => {
    const { page } = await engineCard(
      projectWith({ default: ON_WORK, force: { model: null, effort: "max" }, people: [DWIGHT] }),
    );

    expect(headers(page)[1]).toBe("Claude CodeForced above");
    expect(perPerson(page).querySelectorAll(".project-engine-cell.forced")).toHaveLength(1);
    expect(shownText(perPerson(page).querySelector(".project-engine-cell.forced") as Element)).toBe(
      "Opus 5.5 · Person's setting",
    );
  });

  it("holds Add a person off once everyone not let go has a row", async () => {
    const everyone = ["developer", "reviewer", "planner"].map((roleKey) => ({
      roleKey,
      engineSettings: { codex: { model: null, effort: "low" as const } },
    }));
    const { page } = await engineCard(projectWith({ people: everyone }));

    expect(buttonNamed(perPerson(page), "Add a person")?.disabled).toBe(true);
    expect(shownText(perPerson(page))).toContain("Everyone has a row already.");
  });
});

describe("the Add a person window", () => {
  afterEach(closeCard);

  it("offers the people without a row, hints their Role card and adds one with the toast", async () => {
    const { page, sent } = await engineCard(projectWith({ default: ON_WORK, people: [DWIGHT] }), {
      [PUT_ENGINE]: savedAs(
        projectWith({
          default: ON_WORK,
          people: [
            DWIGHT,
            { roleKey: "reviewer", engineSettings: { codex: { model: null, effort: "high" } } },
          ],
        }),
      ),
    });

    click(buttonNamed(perPerson(page), "Add a person"));
    const dialog = shownDialog();
    expect(shownText(dialog)).toContain("Model and effort for a person in Shop");
    expect(optionLabels(selectIn(dialog, "Person"))).toEqual([
      "Pick a person",
      "Rita · Reviewer",
      "Pam · Planner",
    ]);
    const add = buttonNamed(dialog, "Add");
    expect(add?.disabled).toBe(true);

    await pick(selectIn(dialog, "Person"), "reviewer");
    expect(shownText(groupOf(dialog, "Claude Code"))).toContain("Role card: Sonnet 5.5 · High");
    expect(optionLabels(selectIn(groupOf(dialog, "Codex"), "Effort"))[0]).toBe("Person's setting");
    expect(buttonNamed(dialog, "Add")?.disabled).toBe(true);

    await pick(selectIn(groupOf(dialog, "Codex"), "Effort"), "high");
    click(buttonNamed(dialog, "Add"));

    await until(() =>
      expect(shownText(page)).toContain("Rita has their own model and effort in Shop."),
    );
    expect(sentPeople(sent)).toEqual([
      DWIGHT,
      { roleKey: "reviewer", engineSettings: { codex: { model: null, effort: "high" } } },
    ]);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dims the forced type's row, naming what wins", async () => {
    const { page } = await engineCard(
      projectWith({ default: ON_WORK, force: { model: "claude-opus-5-5", effort: null } }),
    );

    click(buttonNamed(perPerson(page), "Add a person"));
    const row = groupOf(shownDialog(), "Claude Code");

    expect(row.classList.contains("forced")).toBe(true);
    expect(shownText(row)).toContain(
      "Forced above: Opus 5.5 · Engine's default wins while the force is on.",
    );
  });

  it("shows a refusal above the window's bar and keeps the window", async () => {
    const { page } = await engineCard(projectWith({ default: ON_WORK }), {
      [PUT_ENGINE]: refused("Rita is let go."),
    });

    click(buttonNamed(perPerson(page), "Add a person"));
    const dialog = shownDialog();
    await pick(selectIn(dialog, "Person"), "reviewer");
    await pick(selectIn(groupOf(dialog, "Claude Code"), "Model"), "claude-opus-5-5");
    click(buttonNamed(dialog, "Add"));

    await until(() => expect(shownText(shownDialog())).toContain("Rita is let go."));
  });
});

describe("the Edit and Remove windows", () => {
  afterEach(closeCard);

  it("saves a person's settings, keeping a type with no engine listed", async () => {
    const changed: ProjectEnginePerson = {
      roleKey: "developer",
      engineSettings: {
        "claude-code": { model: "claude-opus-5-5", effort: "low" },
        "gemini-cli": { model: "pro", effort: null },
      },
    };
    const { page, sent } = await engineCard(
      projectWith({ default: ON_WORK, people: [DWIGHT, RITA] }),
      {
        [PUT_ENGINE]: savedAs(projectWith({ default: ON_WORK, people: [changed, RITA] })),
      },
    );

    click(buttonNamed(perPerson(page), "Edit Dwight"));
    const dialog = shownDialog();
    expect(shownText(dialog)).toContain("Dwight's model and effort in Shop");
    expect(() => selectIn(dialog, "Person")).toThrow("There is no field Person.");

    await pick(selectIn(groupOf(dialog, "Claude Code"), "Effort"), "low");
    click(buttonNamed(dialog, "Save"));

    await until(() =>
      expect(shownText(page)).toContain("Dwight's model and effort in Shop are saved."),
    );
    expect(sentPeople(sent)).toEqual([changed, RITA]);
  });

  it("holds Save off while nothing is set, pointing to Remove", async () => {
    const { page } = await engineCard(projectWith({ default: ON_WORK, people: [RITA] }));

    click(buttonNamed(perPerson(page), "Edit Rita"));
    const dialog = shownDialog();
    await pick(selectIn(groupOf(dialog, "Codex"), "Effort"), "");

    expect(buttonNamed(dialog, "Save")?.disabled).toBe(true);
    expect(shownText(dialog)).toContain("Nothing is set: Remove Rita instead.");
  });

  it("keeps Save on while a type with no engine listed is still set, sending only that", async () => {
    const kept: ProjectEnginePerson = {
      roleKey: "developer",
      engineSettings: { "gemini-cli": { model: "pro", effort: null } },
    };
    const { page, sent } = await engineCard(projectWith({ default: ON_WORK, people: [DWIGHT] }), {
      [PUT_ENGINE]: savedAs(projectWith({ default: ON_WORK, people: [kept] })),
    });

    click(buttonNamed(perPerson(page), "Edit Dwight"));
    const dialog = shownDialog();
    await pick(selectIn(groupOf(dialog, "Claude Code"), "Model"), "");

    expect(shownText(dialog)).not.toContain("Nothing is set");
    expect(buttonNamed(dialog, "Save")?.disabled).toBe(false);
    click(buttonNamed(dialog, "Save"));

    await until(() =>
      expect(shownText(page)).toContain("Dwight's model and effort in Shop are saved."),
    );
    expect(sentPeople(sent)).toEqual([kept]);
  });

  it("asks before removing a person's settings, then sends the rest", async () => {
    const { page, sent } = await engineCard(
      projectWith({ default: ON_WORK, people: [DWIGHT, RITA] }),
      {
        [PUT_ENGINE]: savedAs(projectWith({ default: ON_WORK, people: [DWIGHT] })),
      },
    );

    click(buttonNamed(perPerson(page), "Remove Rita"));
    const dialog = shownDialog();
    expect(shownText(dialog)).toContain("Remove Rita's settings in Shop?");
    expect(shownText(dialog)).toContain(
      "They work with their Role card's model and effort here again.",
    );
    click(buttonNamed(dialog, "Remove"));

    await until(() =>
      expect(shownText(page)).toContain("Rita's model and effort in Shop are removed."),
    );
    expect(sentPeople(sent)).toEqual([DWIGHT]);
  });

  it("shows a refused removal in its window", async () => {
    const { page } = await engineCard(projectWith({ people: [RITA] }), {
      [PUT_ENGINE]: refused("Shop is being removed."),
    });

    click(buttonNamed(perPerson(page), "Remove Rita"));
    click(buttonNamed(shownDialog(), "Remove"));

    await until(() => expect(shownText(shownDialog())).toContain("Shop is being removed."));
  });
});
