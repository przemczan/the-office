import { describe, expect, it } from "vitest";
import { ALLOWED, ASK_ME, consult } from "./hard-switches.js";
import { aRoleCard } from "./role.fixtures.js";
import {
  roleCardChanges as changesWithDefault,
  type RoleCardFieldChange,
} from "./role-card-changes.js";
import type { RoleCard } from "./role-card.js";

/** As with no duty set: an unset MCP tool consults Devops. */
function roleCardChanges(before: RoleCard, after: RoleCard): RoleCardFieldChange[] {
  return changesWithDefault(before, after, consult("devops"));
}

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

  it("names the engine settings changed, whole, from and to", () => {
    const before = aRoleCard({ engineSettings: { codex: { model: null, effort: "high" } } });
    const after = aRoleCard({
      engineSettings: {
        codex: { model: null, effort: "low" },
        "claude-code": { model: "claude-opus-5-5", effort: null },
      },
    });

    expect(roleCardChanges(before, after)).toEqual([
      { field: "engineSettings", from: before.engineSettings, to: after.engineSettings },
    ]);
  });

  it("reads a type left out as one set to the engine's default model and effort", () => {
    const leftOut = aRoleCard({ engineSettings: {} });
    const atDefaults = aRoleCard({
      engineSettings: { "gemini-cli": { model: null, effort: null } },
    });

    expect(roleCardChanges(leftOut, atDefaults)).toEqual([]);
    expect(
      roleCardChanges(
        aRoleCard({ engineSettings: { codex: { model: "gpt-6-luna", effort: "low" } } }),
        aRoleCard({ engineSettings: { codex: { model: "gpt-6-luna", effort: "low" } } }),
      ),
    ).toEqual([]);
  });

  it("reads an unset MCP tool as the default it is given", () => {
    const unset = aRoleCard();
    const atAskMe = aRoleCard({
      permissionProfile: { ...unset.permissionProfile, mcpTools: { "github/merge": ASK_ME } },
    });

    expect(changesWithDefault(unset, atAskMe, ASK_ME)).toEqual([]);
    expect(changesWithDefault(unset, atAskMe, consult("devops"))).toHaveLength(1);
  });
});
