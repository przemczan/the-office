import { describe, expect, it } from "vitest";
import { presetFor } from "./presets.js";
import { aRole, aRoleCard, OFFERED_MODELS } from "./role.fixtures.js";
import { changeRoleCard, hire, hireBack, hireFromScratch, letGo } from "./role-changes.js";
import { RoleCardChanged, RoleHired, RoleHiredBack, RoleLetGo } from "./role-events.js";
import { RoleRefused } from "./role-refused.js";

const at = new Date("2026-10-25T10:00:00.000Z");

describe("hire", () => {
  it("fills the preset's Role with the named person and the preset's card, at version 1", () => {
    const { role, event } = hire("planner", " Jan ", undefined, at);

    expect(role).toEqual({
      key: "planner",
      card: { ...presetFor("planner")?.card, name: "Jan" },
      cardVersion: 1,
      hiredAt: at,
      cardSavedAt: at,
    });
    expect(event).toEqual(new RoleHired(role));
    expect(event.occurredAt).toEqual(at);
  });

  it("keeps who proposed it, when the user hires from a Proposal", () => {
    expect(hire("planner", "Jan", undefined, at, "office-manager").role.cardProposedBy).toBe(
      "office-manager",
    );
  });

  it("refuses a Role someone already fills, with every reason", () => {
    expect(() => hire("developer", "", aRole(), at)).toThrow(
      new RoleRefused(["Give the person a name.", "Ada already fills the Developer Role."]),
    );
  });

  it("refuses a Role with no preset", () => {
    expect(() => hire("designer", "Dana", undefined, at)).toThrow(
      new RoleRefused(['There is no preset to hire a "designer" from.']),
    );
  });
});

describe("hireFromScratch", () => {
  const card = aRoleCard({ name: " Mia ", title: "Data Analyst" });

  it("fills a new Role, keyed from its title, with the whole card at version 1", () => {
    const { role, event } = hireFromScratch("data-analyst", card, OFFERED_MODELS, undefined, at);

    expect(role).toEqual({
      key: "data-analyst",
      card: { ...card, name: "Mia" },
      cardVersion: 1,
      hiredAt: at,
      cardSavedAt: at,
    });
    expect(event).toEqual(new RoleHired(role));
  });

  it("keeps who proposed the card, when the user hires from a Proposal", () => {
    const { role } = hireFromScratch(
      "data-analyst",
      card,
      OFFERED_MODELS,
      undefined,
      at,
      "office-manager",
    );

    expect(role.cardProposedBy).toBe("office-manager");
    expect(
      changeRoleCard(role, { ...role.card, effort: "low" }, OFFERED_MODELS, at)?.role
        .cardProposedBy,
    ).toBe(undefined);
    expect(
      changeRoleCard(role, { ...role.card, effort: "low" }, OFFERED_MODELS, at, "office-manager")
        ?.role.cardProposedBy,
    ).toBe("office-manager");
  });

  it("refuses a card that breaks a rule, with every reason", () => {
    expect(() =>
      hireFromScratch(
        "data-analyst",
        aRoleCard({ ...card, name: "", taskLimit: 0 }),
        OFFERED_MODELS,
        undefined,
        at,
      ),
    ).toThrow(
      new RoleRefused([
        "Give the person a name.",
        "A Task limit is 1 to 6 Tasks at once, or none.",
      ]),
    );
  });

  it("refuses a title that makes no key", () => {
    expect(() =>
      hireFromScratch("", aRoleCard({ title: "!!!" }), OFFERED_MODELS, undefined, at),
    ).toThrow(new RoleRefused(["Give the Role a title with letters or digits."]));
  });

  it("refuses a Role the presets keep", () => {
    expect(() =>
      hireFromScratch(
        "office-manager",
        aRoleCard({ title: "Office Manager" }),
        OFFERED_MODELS,
        undefined,
        at,
      ),
    ).toThrow(new RoleRefused(["Hire the Office Manager Role from its preset."]));
  });

  it("refuses a Role someone already fills", () => {
    const filledBy = aRole({ key: "data-analyst", card: aRoleCard({ title: "Data Analyst" }) });

    expect(() => hireFromScratch("data-analyst", card, OFFERED_MODELS, filledBy, at)).toThrow(
      new RoleRefused(["Ada already fills the Data Analyst Role."]),
    );
  });
});

describe("changeRoleCard", () => {
  it("saves the edit as the next version and announces what changed", () => {
    const role = aRole();
    const change = changeRoleCard(
      role,
      aRoleCard({ name: " Adele ", taskLimit: 2 }),
      OFFERED_MODELS,
      at,
    );

    expect(change?.role).toEqual({
      ...role,
      card: aRoleCard({ name: "Adele", taskLimit: 2 }),
      cardVersion: 2,
      cardSavedAt: at,
    });
    expect(change?.event).toEqual(
      new RoleCardChanged(change!.role, [
        { field: "name", from: "Ada", to: "Adele" },
        { field: "taskLimit", from: 3, to: 2 },
      ]),
    );
    expect(change?.event.occurredAt).toEqual(at);
  });

  it("saves a changed permission profile as a change", () => {
    const permissionProfile = {
      edit: false,
      run: "read-only-git",
      web: true,
      mcpTools: {},
    } as const;
    const change = changeRoleCard(aRole(), aRoleCard({ permissionProfile }), OFFERED_MODELS, at);

    expect(change?.role.card.permissionProfile).toEqual(permissionProfile);
    expect(change?.event.changes.map(({ field }) => field)).toEqual(["permissionProfile"]);
  });

  it("changes nothing when the card is the same", () => {
    expect(
      changeRoleCard(aRole(), aRoleCard({ name: "Ada " }), OFFERED_MODELS, at),
    ).toBeUndefined();
  });

  it("refuses with every reason", () => {
    expect(() =>
      changeRoleCard(aRole(), aRoleCard({ title: "", taskLimit: 0 }), OFFERED_MODELS, at),
    ).toThrow(
      new RoleRefused(["Give the Role a title.", "A Task limit is 1 to 6 Tasks at once, or none."]),
    );
  });
});

describe("letGo", () => {
  it("marks the person let go and keeps their card", () => {
    const { role, event } = letGo(aRole(), at);

    expect(role).toEqual({ ...aRole(), letGoAt: at });
    expect(event).toEqual(new RoleLetGo(role, at));
    expect(event.occurredAt).toEqual(at);
  });

  it("refuses a person let go already", () => {
    expect(() => letGo(aRole({ letGoAt: at }), at)).toThrow(
      new RoleRefused(["Ada was let go from the Developer Role already."]),
    );
  });
});

describe("hireBack", () => {
  it("fills the Role again with the person as they were", () => {
    const { role, event } = hireBack(aRole({ letGoAt: at }), at);

    expect(role.letGoAt).toBeUndefined();
    expect(role.card).toEqual(aRole().card);
    expect(event).toEqual(new RoleHiredBack(role, at));
  });

  it("refuses a person who fills the Role", () => {
    expect(() => hireBack(aRole(), at)).toThrow(
      new RoleRefused(["Ada fills the Developer Role; nobody was let go."]),
    );
  });
});

describe("a Role whose person was let go", () => {
  const letGoRole = aRole({ letGoAt: at });

  it("refuses another hire into it, pointing to hiring the person back", () => {
    const reason = "Ada was let go from the Developer Role; hire Ada back.";

    expect(() => hire("developer", "Bob", letGoRole, at)).toThrow(new RoleRefused([reason]));
    expect(() =>
      hireFromScratch(
        "developer-2",
        aRoleCard({ title: "Developer 2" }),
        OFFERED_MODELS,
        letGoRole,
        at,
      ),
    ).toThrow(new RoleRefused([reason]));
  });

  it("refuses a change to its card", () => {
    expect(() =>
      changeRoleCard(letGoRole, aRoleCard({ name: "Adele" }), OFFERED_MODELS, at),
    ).toThrow(
      new RoleRefused([
        "Ada was let go from the Developer Role; hire Ada back to change the Role card.",
      ]),
    );
  });
});
