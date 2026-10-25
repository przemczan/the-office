import { describe, expect, it } from "vitest";
import { ALLOWED, consult } from "./hard-switches.js";
import { aRoleCard } from "./role.fixtures.js";
import { changedRoleCardFields, roleCardProblems, trimmedRoleCard } from "./role-card.js";

describe("trimmedRoleCard", () => {
  it("keeps the texts without their surrounding spaces", () => {
    const card = trimmedRoleCard(aRoleCard({ name: " Ada ", title: "Developer\n" }));

    expect(card).toEqual(aRoleCard());
  });
});

describe("roleCardProblems", () => {
  it("accepts a preset's card", () => {
    expect(roleCardProblems("developer", aRoleCard())).toEqual([]);
  });

  it("refuses with every reason", () => {
    const card = aRoleCard({
      name: " ",
      title: "",
      description: "",
      instructions: "",
      model: "claude-opus-4",
      capabilities: { sharedMemory: true, chat: false, consultant: false },
      taskLimit: 7,
      hardSwitches: { ...aRoleCard().hardSwitches, runInstalls: consult("developer") },
    });

    expect(roleCardProblems("developer", card)).toEqual([
      "Give the person a name.",
      "Give the Role a title.",
      "Describe the Role in one paragraph.",
      "Give the instructions the Agent works from.",
      "Choose a model the engine offers.",
      "Shared memory stays off until The Office can keep it.",
      "A Task limit is 1 to 6 Tasks at once, or none.",
      "Run installs can't consult the Role itself.",
    ]);
  });

  it("refuses texts over their length, and a description of more than one paragraph", () => {
    const card = aRoleCard({
      name: "A".repeat(41),
      title: "T".repeat(41),
      description: "One.\n\nTwo.",
      instructions: "I".repeat(8_001),
    });

    expect(roleCardProblems("developer", card)).toEqual([
      "A person's name may be at most 40 characters.",
      "A Role's title may be at most 40 characters.",
      "The instructions may be at most 8000 characters.",
      "The description is one paragraph.",
    ]);
  });

  it("accepts a Task limit of none", () => {
    expect(roleCardProblems("developer", aRoleCard({ taskLimit: "none" }))).toEqual([]);
  });
});

describe("changedRoleCardFields", () => {
  it("names nothing for the same card", () => {
    expect(changedRoleCardFields(aRoleCard(), aRoleCard())).toEqual([]);
  });

  it("names each changed field, capability and switch, in the card's order", () => {
    const before = aRoleCard();
    const after = aRoleCard({
      instructions: "New instructions.",
      taskLimit: 2,
      capabilities: { ...before.capabilities, chat: true },
      permissionProfile: { ...before.permissionProfile, web: false },
      hardSwitches: { ...before.hardSwitches, runInstalls: ALLOWED },
    });

    expect(changedRoleCardFields(before, after)).toEqual([
      "instructions",
      "taskLimit",
      "capabilities.chat",
      "permissionProfile",
      "hardSwitches.runInstalls",
    ]);
  });

  it("tells one consulted Role from another", () => {
    const before = aRoleCard();
    const after = aRoleCard({
      hardSwitches: { ...before.hardSwitches, publishOutsideThePipeline: consult("planner") },
    });

    expect(changedRoleCardFields(before, after)).toEqual([
      "hardSwitches.publishOutsideThePipeline",
    ]);
  });
});
