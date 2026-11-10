import { describe, expect, it } from "vitest";
import { ALLOWED, consult } from "./hard-switches.js";
import { aRoleCard } from "./role.fixtures.js";
import { roleCardChanges } from "./role-card-changes.js";

describe("roleCardChanges", () => {
  it("finds nothing in the same card", () => {
    expect(roleCardChanges(aRoleCard(), aRoleCard())).toEqual([]);
  });

  it("names each changed field, capability and switch, from and to, in the card's order", () => {
    const before = aRoleCard();
    const after = aRoleCard({
      instructions: "New instructions.",
      taskLimit: "none",
      capabilities: { ...before.capabilities, chat: true },
      permissionProfile: { ...before.permissionProfile, web: false },
      hardSwitches: { ...before.hardSwitches, runInstalls: ALLOWED },
    });

    expect(roleCardChanges(before, after)).toEqual([
      { field: "instructions", from: before.instructions, to: "New instructions." },
      { field: "taskLimit", from: 3, to: "none" },
      { field: "capabilities.chat", from: false, to: true },
      {
        field: "permissionProfile",
        from: before.permissionProfile,
        to: after.permissionProfile,
      },
      { field: "hardSwitches.runInstalls", from: consult("devops"), to: ALLOWED },
    ]);
  });

  it("tells one consulted Role from another", () => {
    const before = aRoleCard();
    const after = aRoleCard({
      hardSwitches: { ...before.hardSwitches, publishOutsideThePipeline: consult("planner") },
    });

    expect(roleCardChanges(before, after).map((change) => change.field)).toEqual([
      "hardSwitches.publishOutsideThePipeline",
    ]);
  });

  it("names a Role override set, changed or cleared, none reading as the Office default", () => {
    const opus = { engineId: "claude-code", model: "claude-opus-5-5" };
    const haiku = { engineId: "claude-code", model: "claude-haiku-5-5" };
    const none = aRoleCard({ roleOverride: null });

    expect(roleCardChanges(none, aRoleCard({ roleOverride: opus }))).toEqual([
      { field: "roleOverride", from: null, to: opus },
    ]);
    expect(
      roleCardChanges(aRoleCard({ roleOverride: opus }), aRoleCard({ roleOverride: haiku })),
    ).toEqual([{ field: "roleOverride", from: opus, to: haiku }]);
    expect(roleCardChanges(aRoleCard({ roleOverride: haiku }), none)).toEqual([
      { field: "roleOverride", from: haiku, to: null },
    ]);
    expect(
      roleCardChanges(aRoleCard({ roleOverride: { ...opus } }), aRoleCard({ roleOverride: opus })),
    ).toEqual([]);
  });
});
