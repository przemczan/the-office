import { describe, expect, it } from "vitest";
import { consult } from "./hard-switches.js";
import { aRoleCard, OFFERED_MODELS } from "./role.fixtures.js";
import { roleCardProblems, trimmedRoleCard } from "./role-card.js";

describe("trimmedRoleCard", () => {
  it("keeps the texts without their surrounding spaces", () => {
    const card = trimmedRoleCard(aRoleCard({ name: " Ada ", title: "Developer\n" }));

    expect(card).toEqual(aRoleCard());
  });
});

describe("roleCardProblems", () => {
  it("accepts a preset's card", () => {
    expect(roleCardProblems("developer", aRoleCard(), OFFERED_MODELS)).toEqual([]);
  });

  it("refuses with every reason", () => {
    const card = aRoleCard({
      name: " ",
      title: "",
      responsibilities: "",
      instructions: "",
      model: "claude-opus-4",
      capabilities: { sharedMemory: true, chat: false, consultant: false },
      taskLimit: 7,
      hardSwitches: { ...aRoleCard().hardSwitches, runInstalls: consult("developer") },
    });

    expect(roleCardProblems("developer", card, OFFERED_MODELS)).toEqual([
      "Give the person a name.",
      "Give the Role a title.",
      "Give the Role's responsibilities in one paragraph.",
      "Give the instructions the Agent works from.",
      "Choose a model the engine offers.",
      "A Task limit is 1 to 6 Tasks at once, or none.",
      "Run installs can't consult the Role itself.",
    ]);
  });

  it("refuses texts over their length, and responsibilities of more than one paragraph", () => {
    const card = aRoleCard({
      name: "A".repeat(41),
      title: "T".repeat(41),
      responsibilities: "One.\n\nTwo.",
      instructions: "I".repeat(8_001),
    });

    expect(roleCardProblems("developer", card, OFFERED_MODELS)).toEqual([
      "A person's name may be at most 40 characters.",
      "A Role's title may be at most 40 characters.",
      "The instructions may be at most 8000 characters.",
      "The responsibilities are one paragraph.",
    ]);
  });

  it("accepts a Task limit of none", () => {
    expect(roleCardProblems("developer", aRoleCard({ taskLimit: "none" }), OFFERED_MODELS)).toEqual(
      [],
    );
  });
});
