import { describe, expect, it } from "vitest";
import { consult } from "./hard-switches.js";
import { aRoleCard, CARD_CONTEXT, ENGINE_TYPES_OFFERED } from "./role.fixtures.js";
import { roleCardProblems, trimmedRoleCard, type RoleCardContext } from "./role-card.js";

/** The fixture engines, and an API endpoint offering one model of its own. */
const WITH_AN_API_ENDPOINT: RoleCardContext = {
  ...CARD_CONTEXT,
  engineTypes: (type) =>
    type === "openai-compatible-api"
      ? { listed: true, models: ["qwen3-coder"], efforts: [] }
      : ENGINE_TYPES_OFFERED(type),
};

describe("trimmedRoleCard", () => {
  it("keeps the texts without their surrounding spaces", () => {
    const card = trimmedRoleCard(aRoleCard({ name: " Ada ", title: "Developer\n" }));

    expect(card).toEqual(aRoleCard());
  });
});

describe("roleCardProblems", () => {
  it("accepts a preset's card", () => {
    expect(roleCardProblems("developer", aRoleCard(), CARD_CONTEXT)).toEqual([]);
  });

  it("refuses with every reason", () => {
    const card = aRoleCard({
      name: " ",
      title: "",
      responsibilities: "",
      instructions: "",
      engineSettings: { "claude-code": { model: "claude-opus-4", effort: "high" } },
      capabilities: { sharedMemory: true, chat: false, consultant: false, runEnvironment: false },
      taskLimit: 7,
      hardSwitches: { ...aRoleCard().hardSwitches, runInstalls: consult("developer") },
      permissionProfile: {
        ...aRoleCard().permissionProfile,
        mcpTools: { "github/merge": consult("janitor") },
      },
    });

    expect(roleCardProblems("developer", card, CARD_CONTEXT)).toEqual([
      "Give the person a name.",
      "Give the Role a title.",
      "Give the Role's responsibilities in one paragraph.",
      "Give the instructions the Agent works from.",
      "Choose a model Claude Code offers.",
      "A Task limit is 1 to 6 Tasks at once, or none.",
      "Run installs can't consult the Role itself.",
      "The MCP tool github/merge consults a Role The Office doesn't know.",
    ]);
  });

  it("refuses texts over their length, and responsibilities of more than one paragraph", () => {
    const card = aRoleCard({
      name: "A".repeat(41),
      title: "T".repeat(41),
      responsibilities: "One.\n\nTwo.",
      instructions: "I".repeat(8_001),
    });

    expect(roleCardProblems("developer", card, CARD_CONTEXT)).toEqual([
      "A person's name may be at most 40 characters.",
      "A Role's title may be at most 40 characters.",
      "The instructions may be at most 8000 characters.",
      "The responsibilities are one paragraph.",
    ]);
  });

  it("accepts a Task limit of none", () => {
    expect(roleCardProblems("developer", aRoleCard({ taskLimit: "none" }), CARD_CONTEXT)).toEqual(
      [],
    );
  });

  it("accepts a model each type's listed engines offer and an effort it takes", () => {
    const card = aRoleCard({
      engineSettings: {
        "claude-code": { model: "claude-haiku-5-5", effort: "max" },
        "openai-compatible-api": { model: "qwen3-coder", effort: null },
      },
    });

    expect(roleCardProblems("developer", card, WITH_AN_API_ENDPOINT)).toEqual([]);
  });

  it("refuses a model the type doesn't offer and an effort it doesn't take", () => {
    const card = aRoleCard({
      engineSettings: {
        "claude-code": { model: "qwen3-coder", effort: null },
        "openai-compatible-api": { model: null, effort: "high" },
      },
    });

    expect(roleCardProblems("developer", card, WITH_AN_API_ENDPOINT)).toEqual([
      "Choose a model Claude Code offers.",
      "Choose an effort API endpoint takes.",
    ]);
  });

  it("refuses a new model on a type no engine lists, keeping the one the card has", () => {
    const stored = { codex: { model: "gpt-6-luna", effort: "low" } } as const;
    const kept = aRoleCard({ engineSettings: stored });
    const changed = aRoleCard({
      engineSettings: { codex: { model: "gpt-5.6-terra", effort: "high" } },
    });
    const withStored = { ...CARD_CONTEXT, storedEngineSettings: stored };

    expect(roleCardProblems("developer", kept, withStored)).toEqual([]);
    expect(roleCardProblems("developer", kept, CARD_CONTEXT)).toEqual([
      "Choose a model Codex offers.",
    ]);
    expect(roleCardProblems("developer", changed, withStored)).toEqual([
      "Choose a model Codex offers.",
    ]);
  });
});
