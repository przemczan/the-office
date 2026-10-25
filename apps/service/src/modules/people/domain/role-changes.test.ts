import { describe, expect, it } from "vitest";
import { presetFor } from "./presets.js";
import { aRole, aRoleCard } from "./role.fixtures.js";
import { changeRoleCard, hire } from "./role-changes.js";
import { RoleCardChanged, RoleHired } from "./role-events.js";
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

  it("refuses a Role someone already fills, with every reason", () => {
    expect(() => hire("developer", "", aRole(), at)).toThrow(
      new RoleRefused(["Give the person a name.", "Ada already fills the Developer Role."]),
    );
  });

  it("refuses a Role with no preset", () => {
    expect(() => hire("cto", "Bob", undefined, at)).toThrow(
      new RoleRefused(['There is no preset to hire a "cto" from.']),
    );
  });
});

describe("changeRoleCard", () => {
  it("saves the edit as the next version and announces what changed", () => {
    const role = aRole();
    const change = changeRoleCard(role, aRoleCard({ name: " Adele ", taskLimit: 2 }), at);

    expect(change?.role).toEqual({
      ...role,
      card: aRoleCard({ name: "Adele", taskLimit: 2 }),
      cardVersion: 2,
      cardSavedAt: at,
    });
    expect(change?.event).toEqual(
      new RoleCardChanged(change!.role, role.card, ["name", "taskLimit"]),
    );
    expect(change?.event.occurredAt).toEqual(at);
  });

  it("keeps the permission profile, which is read-only", () => {
    const role = aRole();
    const edit = aRoleCard({
      permissionProfile: { edit: false, run: "read-only-git", web: false },
    });

    expect(changeRoleCard(role, edit, at)).toBeUndefined();
  });

  it("changes nothing when the card is the same", () => {
    expect(changeRoleCard(aRole(), aRoleCard({ name: "Ada " }), at)).toBeUndefined();
  });

  it("refuses with every reason", () => {
    expect(() => changeRoleCard(aRole(), aRoleCard({ title: "", taskLimit: 0 }), at)).toThrow(
      new RoleRefused(["Give the Role a title.", "A Task limit is 1 to 6 Tasks at once, or none."]),
    );
  });
});
