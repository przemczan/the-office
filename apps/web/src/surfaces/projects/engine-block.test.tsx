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
const ON_CODEX = { engineType: "codex", engineId: "codex-1" } as const;

function forceSwitch(page: HTMLElement): HTMLElement {
  const found = groupOf(page, "Model and effort for everyone").querySelector<HTMLElement>(
    '[role="switch"]',
  );
  if (!found) throw new Error("There is no force switch.");
  return found;
}

function where(page: HTMLElement): HTMLElement {
  return groupOf(page, "Where sessions run");
}

describe("the Engine card's Where sessions run", () => {
  afterEach(closeCard);

  it("offers the Office's default first, its Account off and naming the Office's account", async () => {
    const { page } = await engineCard(projectWith({}));

    const type = selectIn(where(page), "Engine type");
    expect(optionLabels(type)).toEqual(["Office's default (Claude Code)", "Claude Code", "Codex"]);
    const account = selectIn(where(page), "Account");
    expect(account.disabled).toBe(true);
    expect(optionLabels(account)).toEqual(["Office's default (Work account)"]);
  });

  it("offers the picked type's accounts only, and picks its first with the toast", async () => {
    const { page, sent } = await engineCard(projectWith({ default: ON_WORK }), {
      [PUT_ENGINE]: savedAs(projectWith({ default: ON_CODEX })),
    });

    expect(optionLabels(selectIn(where(page), "Account"))).toEqual(["Work account", "Personal"]);
    await pick(selectIn(where(page), "Engine type"), "codex");

    await until(() => expect(shownText(page)).toContain("Shop runs on Codex account by default."));
    expect(sent.find(({ request }) => request === PUT_ENGINE)?.body).toEqual({ default: ON_CODEX });
    expect(optionLabels(selectIn(where(page), "Account"))).toEqual(["Codex account"]);
  });

  it("goes back to the Office default with its toast", async () => {
    const { page, sent } = await engineCard(projectWith({ default: ON_WORK }), {
      [PUT_ENGINE]: savedAs(projectWith({})),
    });

    await pick(selectIn(where(page), "Engine type"), "");

    await until(() => expect(shownText(page)).toContain("Shop runs on the Office default again."));
    expect(sent.find(({ request }) => request === PUT_ENGINE)?.body).toEqual({ default: null });
  });

  it("asks before turning the force off with the Office's default, sending both", async () => {
    const forced = projectWith({ default: ON_WORK, force: { model: null, effort: "max" } });
    const { page, sent } = await engineCard(forced, { [PUT_ENGINE]: savedAs(projectWith({})) });

    await pick(selectIn(where(page), "Engine type"), "");

    expect(sent.some(({ request }) => request === PUT_ENGINE)).toBe(false);
    const dialog = shownDialog();
    expect(shownText(dialog)).toContain("Turn off the force too?");
    click(buttonNamed(dialog, "Turn off the force"));

    await until(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    expect(sent.find(({ request }) => request === PUT_ENGINE)?.body).toEqual({
      default: null,
      force: null,
    });
    expect(forceSwitch(page).getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the force on a new type, sending a model it doesn't offer as the engine's default", async () => {
    const forced = projectWith({
      default: ON_WORK,
      force: { model: "claude-opus-5-5", effort: "high" },
    });
    const { page, sent } = await engineCard(forced, {
      [PUT_ENGINE]: savedAs(
        projectWith({ default: ON_CODEX, force: { model: null, effort: "high" } }),
      ),
    });

    await pick(selectIn(where(page), "Engine type"), "codex");

    await until(() => expect(sent.some(({ request }) => request === PUT_ENGINE)).toBe(true));
    expect(sent.find(({ request }) => request === PUT_ENGINE)?.body).toEqual({
      default: ON_CODEX,
      force: { model: null, effort: "high" },
    });
  });

  it("shows a refusal under its group", async () => {
    const { page } = await engineCard(projectWith({}), {
      [PUT_ENGINE]: refused("Codex account can't use Office tools."),
    });

    await pick(selectIn(where(page), "Engine type"), "codex");

    await until(() =>
      expect(shownText(where(page))).toContain("Codex account can't use Office tools."),
    );
  });
});

describe("the Engine card's Model and effort for everyone", () => {
  afterEach(closeCard);

  it("holds the force off without an engine type, saying why", async () => {
    const { page, sent } = await engineCard(projectWith({}));

    click(forceSwitch(page));
    await until(() => expect(forceSwitch(page).getAttribute("tabindex")).toBe("-1"));

    expect(sent.some(({ request }) => request === PUT_ENGINE)).toBe(false);
    expect(shownText(groupOf(page, "Model and effort for everyone"))).toContain(
      "Pick an engine type first.",
    );
  });

  it("turns the force on as the engine's default, then shows Model and Effort with the note", async () => {
    const forced = projectWith({ default: ON_WORK, force: { model: null, effort: null } });
    const { page, sent } = await engineCard(projectWith({ default: ON_WORK }), {
      [PUT_ENGINE]: savedAs(forced),
    });

    click(forceSwitch(page));

    await until(() =>
      expect(shownText(page)).toContain(
        "Everyone in Shop works with Engine's default · Engine's default on Claude Code.",
      ),
    );
    expect(sent.find(({ request }) => request === PUT_ENGINE)?.body).toEqual({
      force: { model: null, effort: null },
    });
    const group = groupOf(page, "Model and effort for everyone");
    expect(optionLabels(selectIn(group, "Model"))).toEqual([
      "Engine's default",
      "Opus 5.5",
      "Sonnet 5.5",
    ]);
    expect(optionLabels(selectIn(group, "Effort"))[0]).toBe("Engine's default");
    expect(shownText(group)).toContain(
      "Only for sessions on Claude Code: one that lands on another type, through an override or a stand-in, works with the settings below.",
    );
  });

  it("saves a forced model at once, sending only the force", async () => {
    const { page, sent } = await engineCard(
      projectWith({ default: ON_WORK, force: { model: null, effort: "max" } }),
      {
        [PUT_ENGINE]: savedAs(
          projectWith({ default: ON_WORK, force: { model: "claude-opus-5-5", effort: "max" } }),
        ),
      },
    );

    await pick(
      selectIn(groupOf(page, "Model and effort for everyone"), "Model"),
      "claude-opus-5-5",
    );

    await until(() =>
      expect(shownText(page)).toContain(
        "Everyone in Shop works with Opus 5.5 · Max on Claude Code.",
      ),
    );
    expect(sent.find(({ request }) => request === PUT_ENGINE)?.body).toEqual({
      force: { model: "claude-opus-5-5", effort: "max" },
    });
  });

  it("turns the force off with its toast", async () => {
    const { page } = await engineCard(
      projectWith({ default: ON_WORK, force: { model: null, effort: null } }),
      { [PUT_ENGINE]: savedAs(projectWith({ default: ON_WORK })) },
    );

    click(forceSwitch(page));

    await until(() =>
      expect(shownText(page)).toContain("People in Shop work with their own settings again."),
    );
  });
});

function standIns(page: HTMLElement): HTMLElement {
  return groupOf(page, "Stand-in Engines");
}

function ownListSwitch(page: HTMLElement): HTMLElement {
  const found = standIns(page).querySelector<HTMLElement>('[role="switch"]');
  if (!found) throw new Error("There is no own-list switch.");
  return found;
}

function rowsOf(page: HTMLElement): HTMLOListElement | null {
  return standIns(page).querySelector<HTMLOListElement>('ol[aria-label="Stand-in Engines"]');
}

const OWN = (engineIds: string[]) => ({ standIns: { useOwnList: true, engineIds } });

describe("the Engine card's Stand-in Engines", () => {
  afterEach(closeCard);

  it("shows the Office's list greyed out and read-only under its link while off", async () => {
    const { page } = await engineCard(projectWith({}));

    expect(ownListSwitch(page).getAttribute("aria-checked")).toBe("false");
    const link = standIns(page).querySelector("a");
    expect(link?.textContent).toBe("From Settings › Engines");
    expect(link?.getAttribute("href")).toBe("/settings/engines");
    const rows = rowsOf(page);
    expect(rows?.hasAttribute("data-read-only")).toBe(true);
    expect([...(rows?.querySelectorAll("li") ?? [])].map((row) => row.textContent)).toEqual([
      "1Personal",
      "2Codex account",
    ]);
    expect(rows?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Claude Code");
    expect(buttonNamed(standIns(page), "Move Personal up")).toBeUndefined();
    expect(() => selectIn(standIns(page), "Add a stand-in")).toThrow(
      "There is no field Add a stand-in.",
    );
  });

  it("shows no list, nor an empty one, until the engines are read", async () => {
    const { page } = await engineCard(
      projectWith({ standIns: { useOwnList: true, engineIds: ["codex-1"] } }),
      {},
      { settingsRead: false },
    );

    expect(rowsOf(page)).toBeNull();
    expect(shownText(standIns(page))).not.toContain("codex-1");
  });

  it("turns the Project's own list on, keeping its list, with the toast", async () => {
    const { page, sent } = await engineCard(
      projectWith({ standIns: { useOwnList: false, engineIds: ["codex-1"] } }),
      { [PUT_ENGINE]: savedAs(projectWith(OWN(["codex-1"]))) },
    );

    click(ownListSwitch(page));

    await until(() => expect(shownText(page)).toContain("Shop uses its own Stand-in Engines."));
    expect(sent.find(({ request }) => request === PUT_ENGINE)?.body).toEqual(OWN(["codex-1"]));
    expect(rowsOf(page)?.hasAttribute("data-read-only")).toBe(false);
    expect(shownText(standIns(page))).toContain(
      "Another engine type: a running Stage waits for the reset rather than switch to it.",
    );
  });

  it("says when the Project's own list is empty, and adds an engine of any type", async () => {
    const { page, sent } = await engineCard(projectWith(OWN([])), {
      [PUT_ENGINE]: savedAs(projectWith(OWN(["personal"]))),
    });

    expect(shownText(standIns(page))).toContain(
      "No Stand-in Engine in Shop, so its work waits for its own engine's usage window to free up.",
    );
    const add = selectIn(standIns(page), "Add a stand-in");
    expect(optionLabels(add).slice(1)).toEqual(["Codex account", "Work account", "Personal"]);
    await pick(add, "personal");

    await until(() => expect(rowsOf(page)).not.toBeNull());
    expect(sent.find(({ request }) => request === PUT_ENGINE)?.body).toEqual(OWN(["personal"]));
    expect(shownText(page)).not.toContain("uses its own Stand-in Engines.");
  });

  it("notes only a row of another type than the Project's engine", async () => {
    const { page } = await engineCard(
      projectWith({ default: ON_CODEX, ...OWN(["personal", "codex-1"]) }),
    );

    const [personal, codex] = [...(rowsOf(page)?.querySelectorAll("li") ?? [])];
    expect(personal?.textContent).toContain("Another engine type");
    expect(codex?.textContent).not.toContain("Another engine type");
  });

  it("moves and removes a stand-in, sending the whole list", async () => {
    const { page, sent } = await engineCard(projectWith(OWN(["personal", "codex-1"])), {
      [PUT_ENGINE]: savedAs(projectWith(OWN(["codex-1", "personal"]))),
    });

    click(buttonNamed(standIns(page), "Move Codex account up"));

    await until(() => expect(sent.some(({ request }) => request === PUT_ENGINE)).toBe(true));
    expect(sent.find(({ request }) => request === PUT_ENGINE)?.body).toEqual(
      OWN(["codex-1", "personal"]),
    );
  });

  it("goes back to the Office's list with its toast, keeping the Project's", async () => {
    const { page } = await engineCard(projectWith(OWN(["personal"])), {
      [PUT_ENGINE]: savedAs(
        projectWith({ standIns: { useOwnList: false, engineIds: ["personal"] } }),
      ),
    });

    click(ownListSwitch(page));
    await until(() =>
      expect(shownText(page)).toContain("Shop uses the Office's Stand-in Engines again."),
    );
    expect(rowsOf(page)?.hasAttribute("data-read-only")).toBe(true);
  });

  it("shows a refusal under its group", async () => {
    const { page } = await engineCard(projectWith(OWN(["personal"])), {
      [PUT_ENGINE]: refused("Pick each Stand-in Engine among the engines listed."),
    });

    click(buttonNamed(standIns(page), "Remove Personal from the Stand-in Engines"));

    await until(() =>
      expect(shownText(standIns(page))).toContain(
        "Pick each Stand-in Engine among the engines listed.",
      ),
    );
  });
});
