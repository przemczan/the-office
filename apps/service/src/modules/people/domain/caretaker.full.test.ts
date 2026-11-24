import { describe, expect, it } from "vitest";
import { CARETAKER_FIXED_PARTS } from "./caretaker.js";
import { ALLOWED, ASK_ME, NEVER } from "./hard-switches.js";
import { CARETAKER } from "./known-roles.js";
import { aRole, aRoleCard, CARD_CONTEXT } from "./role.fixtures.js";
import { changeRoleCard, hireFromScratch, letGo } from "./role-changes.js";
import { RoleRefused } from "./role-refused.js";

const at = new Date("2026-11-03T10:00:00.000Z");

const caretakerCard = aRoleCard({
  name: "Sam",
  title: "Caretaker",
  responsibilities: "Looks after the workstation and The Office.",
  instructions: "Diagnose before you change anything.",
  ...CARETAKER_FIXED_PARTS,
  permissionProfile: { ...CARETAKER_FIXED_PARTS.permissionProfile, mcpTools: {} },
  hardSwitches: { ...CARETAKER_FIXED_PARTS.hardSwitches },
  capabilities: { ...CARETAKER_FIXED_PARTS.capabilities },
});
const caretaker = aRole({ key: CARETAKER, card: caretakerCard });

function refusal(change: () => unknown): readonly string[] {
  try {
    change();
  } catch (error) {
    if (error instanceof RoleRefused) return error.reasons;
    throw error;
  }
  throw new Error("The change was not refused.");
}

describe("the Caretaker's fixed parts", () => {
  // Spec §2.2: setting up The Office gives the Caretaker a tool, never other capabilities or switches.
  it("stay a chat with Memory, the profile Allow changes grants, Change Roles Never and no Task limit", () => {
    expect(CARETAKER_FIXED_PARTS).toEqual({
      capabilities: { sharedMemory: true, chat: true, consultant: false, runEnvironment: false },
      permissionProfile: { edit: true, run: "anything", web: true },
      hardSwitches: {
        runInstalls: ALLOWED,
        publishOutsideThePipeline: ALLOWED,
        changeRoles: NEVER,
        changeProjectSettings: NEVER,
      },
      taskLimit: "none",
    });
  });
});

describe("the Caretaker's card", () => {
  it("takes a change to its instructions, engine settings and MCP tool settings", () => {
    const changed = changeRoleCard(
      caretaker,
      {
        ...caretakerCard,
        instructions: "Look after the backups first.",
        engineSettings: { "claude-code": { model: "claude-opus-5-5", effort: "medium" } },
        permissionProfile: {
          ...caretakerCard.permissionProfile,
          mcpTools: { "github/list_issues": { kind: "allowed" } },
        },
      },
      CARD_CONTEXT,
      at,
      null,
    );

    expect(changed?.role.cardVersion).toBe(2);
    expect(changed?.role.card.engineSettings).toEqual({
      "claude-code": { model: "claude-opus-5-5", effort: "medium" },
    });
  });

  it.each([
    ["capabilities", { capabilities: { ...caretakerCard.capabilities, consultant: true } }],
    ["capabilities", { capabilities: { ...caretakerCard.capabilities, runEnvironment: true } }],
    [
      "permission profile",
      { permissionProfile: { ...caretakerCard.permissionProfile, run: "read-only-git" as const } },
    ],
    ["Hard switches", { hardSwitches: { ...caretakerCard.hardSwitches, runInstalls: ASK_ME } }],
    ["Task limit", { taskLimit: 2 }],
  ])("refuses a change to its %s", (part, fields) => {
    expect(
      refusal(() =>
        changeRoleCard(caretaker, { ...caretakerCard, ...fields }, CARD_CONTEXT, at, null),
      ),
    ).toEqual([expect.stringContaining(`The Caretaker's ${part}`)]);
  });

  it("leaves every other Role's card free", () => {
    const changed = changeRoleCard(
      aRole(),
      aRoleCard({ taskLimit: "none" }),
      CARD_CONTEXT,
      at,
      null,
    );

    expect(changed?.role.card.taskLimit).toBe("none");
  });
});

describe("the Caretaker's Role", () => {
  it("is never let go", () => {
    expect(refusal(() => letGo(caretaker, at))).toEqual([
      "Sam is the built-in Caretaker: never let go.",
    ]);
  });

  it("takes nobody hired from scratch into its key", () => {
    expect(
      refusal(() => hireFromScratch(CARETAKER, caretakerCard, CARD_CONTEXT, undefined, at, null)),
    ).toContain("The Caretaker is built in: nobody else is hired into their Role.");
  });
});
