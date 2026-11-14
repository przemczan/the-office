import { describe, expect, it } from "vitest";
import { presetFor } from "./presets.js";
import { aRole, aRoleCard, CARD_CONTEXT } from "./role.fixtures.js";
import {
  changeAvatar,
  changeRoleCard,
  hire,
  hireBack,
  hireFromScratch,
  letGo,
  moveRoleOverride,
} from "./role-changes.js";
import {
  RoleAvatarChanged,
  RoleCardChanged,
  RoleHired,
  RoleHiredBack,
  RoleLetGo,
} from "./role-events.js";
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
      avatar: null,
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
    const { role, event } = hireFromScratch("data-analyst", card, CARD_CONTEXT, undefined, at);

    expect(role).toEqual({
      key: "data-analyst",
      card: { ...card, name: "Mia" },
      cardVersion: 1,
      hiredAt: at,
      cardSavedAt: at,
      avatar: null,
    });
    expect(event).toEqual(new RoleHired(role));
  });

  it("keeps who proposed the card, when the user hires from a Proposal", () => {
    const { role } = hireFromScratch(
      "data-analyst",
      card,
      CARD_CONTEXT,
      undefined,
      at,
      "office-manager",
    );

    expect(role.cardProposedBy).toBe("office-manager");
    expect(
      changeRoleCard(role, { ...role.card, effort: "low" }, CARD_CONTEXT, at)?.role.cardProposedBy,
    ).toBe(undefined);
    expect(
      changeRoleCard(role, { ...role.card, effort: "low" }, CARD_CONTEXT, at, "office-manager")
        ?.role.cardProposedBy,
    ).toBe("office-manager");
  });

  it("refuses a card that breaks a rule, with every reason", () => {
    expect(() =>
      hireFromScratch(
        "data-analyst",
        aRoleCard({ ...card, name: "", taskLimit: 0 }),
        CARD_CONTEXT,
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
      hireFromScratch("", aRoleCard({ title: "!!!" }), CARD_CONTEXT, undefined, at),
    ).toThrow(new RoleRefused(["Give the Role a title with letters or digits."]));
  });

  it("refuses a Role the presets keep", () => {
    expect(() =>
      hireFromScratch(
        "office-manager",
        aRoleCard({ title: "Office Manager" }),
        CARD_CONTEXT,
        undefined,
        at,
      ),
    ).toThrow(new RoleRefused(["Hire the Office Manager Role from its preset."]));
  });

  it("refuses a Role someone already fills", () => {
    const filledBy = aRole({ key: "data-analyst", card: aRoleCard({ title: "Data Analyst" }) });

    expect(() => hireFromScratch("data-analyst", card, CARD_CONTEXT, filledBy, at)).toThrow(
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
      CARD_CONTEXT,
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
    const change = changeRoleCard(aRole(), aRoleCard({ permissionProfile }), CARD_CONTEXT, at);

    expect(change?.role.card.permissionProfile).toEqual(permissionProfile);
    expect(change?.event.changes.map(({ field }) => field)).toEqual(["permissionProfile"]);
  });

  it("changes nothing when the card is the same", () => {
    expect(changeRoleCard(aRole(), aRoleCard({ name: "Ada " }), CARD_CONTEXT, at)).toBeUndefined();
  });

  it("refuses with every reason", () => {
    expect(() =>
      changeRoleCard(aRole(), aRoleCard({ title: "", taskLimit: 0 }), CARD_CONTEXT, at),
    ).toThrow(
      new RoleRefused(["Give the Role a title.", "A Task limit is 1 to 6 Tasks at once, or none."]),
    );
  });
});

describe("moveRoleOverride", () => {
  const onStrata = { engineId: "strata", model: "qwen3" };
  const onClaudeCode = { engineId: "claude-code", model: "claude-haiku-5-5" };
  const toClaudeCode = (reference: typeof onStrata) =>
    reference.engineId === "strata" ? onClaudeCode : reference;

  it("saves the moved override as the next version by the user, a let-go Role's too", () => {
    const role = aRole({
      card: aRoleCard({ roleOverride: onStrata }),
      cardProposedBy: "cto",
      letGoAt: at,
    });
    const change = moveRoleOverride(role, toClaudeCode, at);

    expect(change?.role).toEqual({
      ...role,
      card: aRoleCard({ roleOverride: onClaudeCode }),
      cardVersion: 2,
      cardSavedAt: at,
      cardProposedBy: undefined,
    });
    expect(change?.event).toEqual(
      new RoleCardChanged(change!.role, [
        { field: "roleOverride", from: onStrata, to: onClaudeCode },
      ]),
    );
  });

  it("saves an override moved to none, as the only engine goes, as the next version", () => {
    const change = moveRoleOverride(
      aRole({ card: aRoleCard({ roleOverride: onStrata }) }),
      () => null,
      at,
    );

    expect(change?.role.card.roleOverride).toBeNull();
    expect(change?.role.cardVersion).toBe(2);
    expect(change?.event).toEqual(
      new RoleCardChanged(change!.role, [{ field: "roleOverride", from: onStrata, to: null }]),
    );
  });

  it("changes nothing when the override stays, or there is none", () => {
    expect(
      moveRoleOverride(
        aRole({ card: aRoleCard({ roleOverride: onClaudeCode }) }),
        toClaudeCode,
        at,
      ),
    ).toBeUndefined();
    expect(
      moveRoleOverride(aRole({ card: aRoleCard({ roleOverride: null }) }), toClaudeCode, at),
    ).toBeUndefined();
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
        CARD_CONTEXT,
        letGoRole,
        at,
      ),
    ).toThrow(new RoleRefused([reason]));
  });

  it("refuses a change to its card", () => {
    expect(() => changeRoleCard(letGoRole, aRoleCard({ name: "Adele" }), CARD_CONTEXT, at)).toThrow(
      new RoleRefused([
        "Ada was let go from the Developer Role; hire Ada back to change the Role card.",
      ]),
    );
  });
});

describe("changeAvatar", () => {
  const AVATAR = { id: "an-id", mediaType: "image/png" } as const;
  const AT = new Date("2026-11-07T09:00:00.000Z");

  it("gives the person the Avatar, leaving the card and its version", () => {
    const role = aRole();

    const change = changeAvatar(role, AVATAR, AT);

    expect(change?.role).toEqual({ ...role, avatar: AVATAR });
    expect(change?.event).toBeInstanceOf(RoleAvatarChanged);
    expect(change?.event.occurredAt).toEqual(AT);
  });

  it("removes it", () => {
    expect(changeAvatar(aRole({ avatar: AVATAR }), null, AT)?.role.avatar).toBeNull();
  });

  it("changes nothing when there is none to remove", () => {
    expect(changeAvatar(aRole(), null, AT)).toBeUndefined();
  });

  it("refuses someone let go until they are hired back", () => {
    const role = aRole({ avatar: AVATAR, letGoAt: AT });

    expect(() => changeAvatar(role, null, AT)).toThrow(RoleRefused);
    expect(() => changeAvatar(role, { ...AVATAR, id: "another-id" }, AT)).toThrow(
      "Ada was let go from the Developer Role; hire Ada back to change their Avatar.",
    );
    expect(changeAvatar({ ...role, letGoAt: undefined }, null, AT)?.role.avatar).toBeNull();
  });
});
