import { describe, expect, it } from "vitest";
import { presetAuthority } from "./authority.js";
import { DUTIES } from "./duties.js";
import { dutiesSuitedTo, PRESETS, presetFor } from "./presets.js";
import { CARD_CONTEXT } from "./role.fixtures.js";
import { roleCardProblems } from "./role-card.js";

describe("PRESETS", () => {
  it("are the Planner, Developer, Reviewer, CTO, Devops and Office Manager", () => {
    expect(PRESETS.map((preset) => preset.roleKey)).toEqual([
      "planner",
      "developer",
      "reviewer",
      "cto",
      "devops",
      "office-manager",
    ]);
  });

  // Spec §2.2's preset table and §9's Task limits.
  it.each([
    ["planner", { sharedMemory: true, chat: true, consultant: true, runEnvironment: false }, 2],
    ["developer", { sharedMemory: false, chat: false, consultant: false, runEnvironment: true }, 3],
    ["reviewer", { sharedMemory: false, chat: false, consultant: false, runEnvironment: false }, 3],
    ["cto", { sharedMemory: true, chat: true, consultant: true, runEnvironment: false }, 2],
    ["devops", { sharedMemory: true, chat: true, consultant: true, runEnvironment: true }, 2],
    [
      "office-manager",
      { sharedMemory: true, chat: true, consultant: false, runEnvironment: false },
      "none",
    ],
  ])(
    "give the %s the capabilities %o and a Task limit of %s",
    (roleKey, capabilities, taskLimit) => {
      expect(presetFor(roleKey)?.card).toMatchObject({ capabilities, taskLimit });
    },
  );

  // Spec §6 › Defaults: a preset's card stands at its defaults (`presetAuthority`), setting no row.
  it.each(PRESETS.map((preset) => [preset.roleKey, preset]))(
    "give the %s no Authority row of its own",
    (_roleKey, preset) => {
      expect(preset.card.authority).toEqual({});
    },
  );

  // Spec §6's default profiles, every MCP tool at its default; a chat only reads.
  it.each([
    ["planner", { edit: false, run: "read-only-git", web: true }],
    ["office-manager", { edit: false, run: "read-only-git", web: true }],
    ["developer", { edit: true, run: "anything", web: true }],
    ["cto", { edit: true, run: "anything", web: true }],
    ["devops", { edit: true, run: "anything", web: true }],
    ["reviewer", { edit: false, run: "project-commands", web: true }],
  ])("give the %s the permission profile %o", (roleKey, permissionProfile) => {
    expect(presetFor(roleKey)?.card.permissionProfile).toEqual({
      ...permissionProfile,
      mcpTools: {},
    });
  });

  it.each(PRESETS)("keep the rules with the suggested name ($roleKey)", (preset) => {
    const card = { ...preset.card, name: preset.suggestedName };

    expect(roleCardProblems(preset.roleKey, card, CARD_CONTEXT)).toEqual([]);
  });

  // Spec §6 › Authority: who may do what is the card's Authority, no longer words in the instructions.
  it.each(PRESETS)("leave who may do what to the Authority ($roleKey)", (preset) => {
    expect(preset.card.instructions).not.toMatch(
      /Decide alone:|Ask the user:|Consult [^\n]* first:/,
    );
  });

  // The records a person creates in a chat: theirs to correct, another's only by asking the user.
  it.each([
    ["planner", "taskRecords"],
    ["cto", "initiativeRecords"],
    ["devops", "taskRecords"],
    ["office-manager", "initiativeRecords"],
  ] as const)(
    "let the %s correct their own %s, asking the user about another's",
    (roleKey, group) => {
      expect(presetAuthority(roleKey)[group]).toEqual({
        kind: "own-and-others",
        own: { kind: "allowed" },
        others: { kind: "ask-me" },
      });
    },
  );

  it("work with each engine's default model, and their effort on each type that takes it", () => {
    expect(presetFor("developer")?.card.engineSettings).toEqual({
      "claude-code": { model: null, effort: "high" },
      codex: { model: null, effort: "high" },
    });
    expect(presetFor("office-manager")?.card.engineSettings).toEqual({
      "claude-code": { model: null, effort: "medium" },
      codex: { model: null, effort: "medium" },
    });
  });
});

describe("dutiesSuitedTo", () => {
  it("gives each preset the duties its key holds by default", () => {
    expect(
      Object.fromEntries(PRESETS.map((preset) => [preset.roleKey, dutiesSuitedTo(preset)])),
    ).toEqual({
      planner: ["plans"],
      developer: ["implements"],
      reviewer: ["reviews"],
      cto: ["shapes-initiatives", "asked-first-when-out-of-tries"],
      devops: ["onboards-projects", "mcp-tool-consultant"],
      "office-manager": ["default-person-to-talk-to"],
    });
  });

  it("suits every duty to exactly one preset, as the duties' defaults name them", () => {
    const suited = PRESETS.flatMap(dutiesSuitedTo);

    expect(suited.toSorted()).toEqual(DUTIES.map((duty) => duty.key).toSorted());
  });
});
