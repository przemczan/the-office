import { describe, expect, it } from "vitest";
import { FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../../engine/index.js";
import { presetFor } from "./presets.js";
import { aRole, aRoleCard, CARD_CONTEXT } from "./role.fixtures.js";
import {
  changeAvatar,
  changeRoleCard,
  hire,
  hireBack,
  hireFromScratch,
  engineSettingsMovedOver,
  letGo,
  moveEngineSettingsOver,
} from "./role-changes.js";
import {
  RoleAvatarChanged,
  RoleCardChanged,
  RoleHired,
  RoleHiredBack,
  RoleLetGo,
} from "./role-events.js";
import { RoleRefused } from "./role-refused.js";
import { ANN_LEE, BEN_ITO } from "./user.fixtures.js";

const at = new Date("2026-10-25T10:00:00.000Z");

describe("hire", () => {
  it("fills the preset's Role with the named person and the preset's card, at version 1", () => {
    const { role, event } = hire("planner", " Jan ", undefined, at, ANN_LEE);

    expect(role).toEqual({
      key: "planner",
      card: { ...presetFor("planner")?.card, name: "Jan" },
      cardVersion: 1,
      hiredAt: at,
      cardSavedAt: at,
      cardSavedBy: ANN_LEE,
      avatar: null,
    });
    expect(event).toEqual(new RoleHired(role));
    expect(event.occurredAt).toEqual(at);
  });

  it("keeps who proposed it and the user who applied it, when the user hires from a Proposal", () => {
    const { role } = hire("planner", "Jan", undefined, at, BEN_ITO, "office-manager");

    expect(role.cardProposedBy).toBe("office-manager");
    expect(role.cardSavedBy).toEqual(BEN_ITO);
  });

  it("refuses a Role someone already fills, with every reason", () => {
    expect(() => hire("developer", "", aRole(), at, ANN_LEE)).toThrow(
      new RoleRefused(["Give the person a name.", "Ada already fills the Developer Role."]),
    );
  });

  it("refuses a Role with no preset", () => {
    expect(() => hire("designer", "Dana", undefined, at, ANN_LEE)).toThrow(
      new RoleRefused(['There is no preset to hire a "designer" from.']),
    );
  });
});

describe("hireFromScratch", () => {
  const card = aRoleCard({ name: " Mia ", title: "Data Analyst" });

  it("fills a new Role, keyed from its title, with the whole card at version 1", () => {
    const { role, event } = hireFromScratch(
      "data-analyst",
      card,
      CARD_CONTEXT,
      undefined,
      at,
      ANN_LEE,
    );

    expect(role).toEqual({
      key: "data-analyst",
      card: { ...card, name: "Mia" },
      cardVersion: 1,
      hiredAt: at,
      cardSavedAt: at,
      cardSavedBy: ANN_LEE,
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
      BEN_ITO,
      "office-manager",
    );

    expect(role.cardProposedBy).toBe("office-manager");
    expect(role.cardSavedBy).toEqual(BEN_ITO);
    const edit = {
      ...role.card,
      engineSettings: { "claude-code": { model: null, effort: "low" } },
    } as const;
    expect(changeRoleCard(role, edit, CARD_CONTEXT, at, ANN_LEE)?.role).toMatchObject({
      cardProposedBy: undefined,
      cardSavedBy: ANN_LEE,
    });
    expect(
      changeRoleCard(role, edit, CARD_CONTEXT, at, BEN_ITO, "office-manager")?.role,
    ).toMatchObject({ cardProposedBy: "office-manager", cardSavedBy: BEN_ITO });
    expect(
      changeRoleCard(role, edit, CARD_CONTEXT, at, null, "office-manager")?.role.cardSavedBy,
    ).toBeNull();
  });

  it("refuses a card that breaks a rule, with every reason", () => {
    expect(() =>
      hireFromScratch(
        "data-analyst",
        aRoleCard({ ...card, name: "", taskLimit: 0 }),
        CARD_CONTEXT,
        undefined,
        at,
        ANN_LEE,
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
      hireFromScratch("", aRoleCard({ title: "!!!" }), CARD_CONTEXT, undefined, at, ANN_LEE),
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
        ANN_LEE,
      ),
    ).toThrow(new RoleRefused(["Hire the Office Manager Role from its preset."]));
  });

  it("refuses a Role someone already fills", () => {
    const filledBy = aRole({ key: "data-analyst", card: aRoleCard({ title: "Data Analyst" }) });

    expect(() =>
      hireFromScratch("data-analyst", card, CARD_CONTEXT, filledBy, at, ANN_LEE),
    ).toThrow(new RoleRefused(["Ada already fills the Data Analyst Role."]));
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
      ANN_LEE,
    );

    expect(change?.role).toEqual({
      ...role,
      card: aRoleCard({ name: "Adele", taskLimit: 2 }),
      cardVersion: 2,
      cardSavedAt: at,
      cardSavedBy: ANN_LEE,
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
    const change = changeRoleCard(
      aRole(),
      aRoleCard({ permissionProfile }),
      CARD_CONTEXT,
      at,
      ANN_LEE,
    );

    expect(change?.role.card.permissionProfile).toEqual(permissionProfile);
    expect(change?.event.changes.map(({ field }) => field)).toEqual(["permissionProfile"]);
  });

  it("changes nothing when the card is the same", () => {
    expect(
      changeRoleCard(aRole(), aRoleCard({ name: "Ada " }), CARD_CONTEXT, at, ANN_LEE),
    ).toBeUndefined();
  });

  it("refuses with every reason", () => {
    expect(() =>
      changeRoleCard(aRole(), aRoleCard({ title: "", taskLimit: 0 }), CARD_CONTEXT, at, null),
    ).toThrow(
      new RoleRefused(["Give the Role a title.", "A Task limit is 1 to 6 Tasks at once, or none."]),
    );
  });
});

describe("moveEngineSettingsOver", () => {
  const gemini: Engine = {
    id: "gemini",
    name: "Gemini",
    kind: "gemini-cli",
    defaultModel: "auto",
    defaultEffort: null,
    apiKey: null,
  };
  const engines = [FIRST_CLAUDE_CODE_ENGINE, gemini];
  const opusOnClaudeCode = { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-opus-5-5" };

  it("puts the effort on every engine type that takes it, listed or not", () => {
    expect(moveEngineSettingsOver({ roleOverride: null, effort: "high" }, engines)).toEqual({
      engineSettings: {
        "claude-code": { model: null, effort: "high" },
        codex: { model: null, effort: "high" },
      },
      changes: [
        { field: "engineSettingsMovedOver", from: null, to: null },
        {
          field: "engineSettings",
          from: {},
          to: {
            "claude-code": { model: null, effort: "high" },
            codex: { model: null, effort: "high" },
          },
        },
      ],
    });
    expect(
      moveEngineSettingsOver({ roleOverride: null, effort: "max" }, []).engineSettings,
    ).toEqual({ "claude-code": { model: null, effort: "max" } });
  });

  it("makes a Role override the model on its engine's type, naming the type it moved to", () => {
    const moved = moveEngineSettingsOver(
      { roleOverride: opusOnClaudeCode, effort: "low" },
      engines,
    );

    expect(moved.engineSettings).toEqual({
      "claude-code": { model: "claude-opus-5-5", effort: "low" },
      codex: { model: null, effort: "low" },
    });
    expect(moved.changes[0]).toEqual({
      field: "engineSettingsMovedOver",
      from: opusOnClaudeCode,
      to: "claude-code",
    });
  });

  it("gives a Role override on a type taking no effort its model only", () => {
    const onGemini = { engineId: "gemini", model: "pro" };

    expect(
      moveEngineSettingsOver({ roleOverride: onGemini, effort: "medium" }, engines).engineSettings,
    ).toEqual({
      "claude-code": { model: null, effort: "medium" },
      codex: { model: null, effort: "medium" },
      "gemini-cli": { model: "pro", effort: null },
    });
  });

  it("drops a Role override on an engine no longer listed, still naming it", () => {
    const onRemoved = { engineId: "removed", model: "qwen3" };
    const moved = moveEngineSettingsOver({ roleOverride: onRemoved, effort: "high" }, engines);

    expect(moved.engineSettings).toEqual({
      "claude-code": { model: null, effort: "high" },
      codex: { model: null, effort: "high" },
    });
    expect(moved.changes[0]).toEqual({
      field: "engineSettingsMovedOver",
      from: onRemoved,
      to: null,
    });
  });
});

describe("engineSettingsMovedOver", () => {
  it("saves the moved settings as the next version naming no user, a let-go Role's too", () => {
    const role = aRole({ cardProposedBy: "cto", cardSavedBy: ANN_LEE, letGoAt: at });
    const { role: moved, event } = engineSettingsMovedOver(
      role,
      { roleOverride: null, effort: "low" },
      [FIRST_CLAUDE_CODE_ENGINE],
      at,
    );

    expect(moved).toEqual({
      ...role,
      card: {
        ...role.card,
        engineSettings: {
          "claude-code": { model: null, effort: "low" },
          codex: { model: null, effort: "low" },
        },
      },
      cardVersion: 2,
      cardSavedAt: at,
      cardProposedBy: undefined,
      cardSavedBy: null,
    });
    expect(event).toEqual(
      new RoleCardChanged(moved, [
        { field: "engineSettingsMovedOver", from: null, to: null },
        { field: "engineSettings", from: {}, to: moved.card.engineSettings },
      ]),
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

    expect(() => hire("developer", "Bob", letGoRole, at, ANN_LEE)).toThrow(
      new RoleRefused([reason]),
    );
    expect(() =>
      hireFromScratch(
        "developer-2",
        aRoleCard({ title: "Developer 2" }),
        CARD_CONTEXT,
        letGoRole,
        at,
        ANN_LEE,
      ),
    ).toThrow(new RoleRefused([reason]));
  });

  it("refuses a change to its card", () => {
    expect(() =>
      changeRoleCard(letGoRole, aRoleCard({ name: "Adele" }), CARD_CONTEXT, at, ANN_LEE),
    ).toThrow(
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
