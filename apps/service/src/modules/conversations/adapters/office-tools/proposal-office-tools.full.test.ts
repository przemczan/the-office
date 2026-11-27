import { PROPOSE_OFFICE_SETUP_TOOL as CONTRACT_PROPOSE_OFFICE_SETUP_TOOL } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleNotFound, type Duties, type RoleService } from "../../../people/index.js";
import type { OfficeInstructions } from "../../application/office-instructions.js";
import type { ProposalService } from "../../application/proposal-service.js";
import type { ProposedChange } from "../../domain/proposal.js";
import { aProposedCard } from "../../domain/proposal.fixtures.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import {
  PROPOSE_OFFICE_SETUP_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
} from "../../domain/session-instructions.js";
import { ProposalOfficeTools } from "./proposal-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

const tester = { role: { key: "tester", card: aProposedCard() } };

/**
 * The tool named `name` as registered, over Proposals that keep what is drafted, refusing with
 * `refusal`.
 */
function toolDrafting(refusal: string | undefined, name: string, instructionsNow = "") {
  const drafted: ProposedChange[] = [];
  const draft = (change: (typeof drafted)[number]) => {
    if (refusal) return Promise.reject(new ProposalRefused([refusal]));
    drafted.push(change);
    return Promise.resolve();
  };
  const proposals = {
    draft: (_sessionId: string, change: ProposedChange) => draft(change),
  } as unknown as ProposalService;
  const roles = {
    read: (key: string) =>
      key === "tester" ? Promise.resolve(tester) : Promise.reject(new RoleNotFound(key)),
    presets: () => [
      { roleKey: "developer", card: { title: "Developer" } },
      { roleKey: "planner", card: { title: "Planner" } },
    ],
  } as unknown as RoleService;
  const officeInstructions = {
    current: () => Promise.resolve({ version: 2, text: instructionsNow }),
  } as unknown as OfficeInstructions;
  // As on a fresh Office: every duty at its default Role key, Implements set to another Role.
  const duties = {
    list: () =>
      Promise.resolve([
        { duty: "plans", roleKey: "planner" },
        { duty: "implements", roleKey: "lead" },
      ]),
  } as unknown as Duties;
  const registry = new OfficeToolRegistry();
  new ProposalOfficeTools(registry, proposals, roles, officeInstructions, duties).onModuleInit();
  const [tool] = registry.named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`${name} is not registered.`);
  return { tool, drafted };
}

const session = anOfficeToolCall("session-1");

/** What the Agent reads when it names a person by the Role's title. */
function namedByTheTitle(name: string) {
  return {
    text: `"${name}" is the Role's title; give the person a first name of their own as card.name.`,
    isError: true,
  };
}

describe("the propose_office_setup tool", () => {
  it("is named as the contracts name it", () => {
    expect(PROPOSE_OFFICE_SETUP_TOOL).toBe(CONTRACT_PROPOSE_OFFICE_SETUP_TOOL);
  });

  it("names each preset with its title and duties, and each duty with its label", () => {
    const { tool } = toolDrafting(undefined, PROPOSE_OFFICE_SETUP_TOOL);

    expect(tool.description).toContain("developer (Developer; implements)");
    expect(tool.description).toContain("planner (Planner; plans)");
    expect(tool.description).toContain("reviews (Reviews)");
  });

  it("drafts the hires and the duties, each duty from the Role it names now", async () => {
    const { tool, drafted } = toolDrafting(undefined, PROPOSE_OFFICE_SETUP_TOOL);

    const result = await tool.run(
      {
        hires: [
          { preset: " planner ", name: "Jan" },
          { card: aProposedCard({ name: "Max", title: "Builder" }), skills: ["playwright"] },
        ],
        duties: [{ duty: " implements ", holder: " builder " }],
      },
      session,
    );

    expect(result.isError).toBe(false);
    expect(drafted).toEqual([
      {
        kind: "office-setup",
        hires: [
          { kind: "hire-from-preset", roleKey: "planner", name: "Jan" },
          {
            kind: "hire",
            card: aProposedCard({ name: "Max", title: "Builder" }),
            skills: ["playwright"],
          },
        ],
        duties: [{ duty: "implements", from: "lead", to: "builder" }],
        hiredKeys: undefined,
      },
    ]);
  });

  it("refuses a hire or a duty given wrong, drafting nothing", async () => {
    const { tool, drafted } = toolDrafting(undefined, PROPOSE_OFFICE_SETUP_TOOL);

    await expect(
      tool.run({ hires: [{ preset: "developer", name: "Developer" }], duties: [] }, session),
    ).resolves.toEqual(namedByTheTitle("Developer"));
    await expect(
      tool.run(
        { hires: [{ preset: "developer", name: "Ada", card: { taskLimit: 2 } }], duties: [] },
        session,
      ),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      tool.run({ hires: [{ card: { name: "Max" } }], duties: [] }, session),
    ).resolves.toMatchObject({
      text: expect.stringContaining("A new Role needs its whole Role card"),
      isError: true,
    });
    await expect(
      tool.run({ hires: [], duties: [{ duty: "sweeps", holder: "planner" }] }, session),
    ).resolves.toMatchObject({ text: expect.stringContaining('no duty "sweeps"'), isError: true });
    expect(drafted).toEqual([]);
  });

  it("gives the Agent the owner's reasons a set-up is refused", async () => {
    const { tool } = toolDrafting("Nothing to set up.", PROPOSE_OFFICE_SETUP_TOOL);

    await expect(tool.run({ hires: [], duties: [] }, session)).resolves.toEqual({
      text: "Nothing to set up.",
      isError: true,
    });
  });
});

describe("the read_office_instructions tool", () => {
  it("answers the text now", async () => {
    const { tool } = toolDrafting(undefined, READ_OFFICE_INSTRUCTIONS_TOOL, "Keep it short.");

    await expect(tool.run({}, session)).resolves.toEqual({
      text: "Keep it short.",
      isError: false,
    });
  });

  it("says so when they are empty", async () => {
    const { tool } = toolDrafting(undefined, READ_OFFICE_INSTRUCTIONS_TOOL);

    await expect(tool.run({}, session)).resolves.toEqual({
      text: "The Office instructions are empty.",
      isError: false,
    });
  });
});
