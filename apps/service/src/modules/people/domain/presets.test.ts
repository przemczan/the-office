import { describe, expect, it } from "vitest";
import { consult, NEVER } from "./hard-switches.js";
import { PRESETS, presetFor } from "./presets.js";
import { roleCardProblems } from "./role-card.js";

describe("PRESETS", () => {
  it("are tier 1's Planner, Developer and Reviewer", () => {
    expect(PRESETS.map((preset) => preset.roleKey)).toEqual(["planner", "developer", "reviewer"]);
  });

  // Spec §2.2's preset table, with shared memory off until tier 2, and §9's Task limits.
  it.each([
    ["planner", { sharedMemory: false, chat: true, consultant: true }, 2],
    ["developer", { sharedMemory: false, chat: false, consultant: false }, 3],
    ["reviewer", { sharedMemory: false, chat: false, consultant: false }, 3],
  ])(
    "give the %s the capabilities %o and a Task limit of %s",
    (roleKey, capabilities, taskLimit) => {
      expect(presetFor(roleKey)?.card).toMatchObject({ capabilities, taskLimit });
    },
  );

  // Spec §6's Hard switches table.
  it.each([
    ["planner", { runInstalls: consult("devops"), publishOutsideThePipeline: NEVER }],
    ["developer", { runInstalls: consult("devops"), publishOutsideThePipeline: consult("cto") }],
    ["reviewer", { runInstalls: consult("devops"), publishOutsideThePipeline: NEVER }],
  ])("give the %s the Hard switches %o, and Change Roles Never", (roleKey, switches) => {
    expect(presetFor(roleKey)?.card.hardSwitches).toEqual({ ...switches, changeRoles: NEVER });
  });

  // Spec §6's default profiles.
  it.each([
    ["planner", { edit: false, run: "read-only-git", web: true }],
    ["developer", { edit: true, run: "anything", web: true }],
    ["reviewer", { edit: false, run: "project-commands", web: true }],
  ])("give the %s the permission profile %o", (roleKey, permissionProfile) => {
    expect(presetFor(roleKey)?.card.permissionProfile).toEqual(permissionProfile);
  });

  it.each(PRESETS)("keep the rules with the suggested name ($roleKey)", (preset) => {
    const card = { ...preset.card, name: preset.suggestedName };

    expect(roleCardProblems(preset.roleKey, card)).toEqual([]);
  });
});
