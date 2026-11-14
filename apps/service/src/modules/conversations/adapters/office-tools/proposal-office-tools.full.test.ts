import {
  PROPOSE_OFFICE_SETTING_TOOL as CONTRACT_PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_OFFICE_SETUP_TOOL as CONTRACT_PROPOSE_OFFICE_SETUP_TOOL,
  PROPOSE_ROLE_TOOL as CONTRACT_PROPOSE_ROLE_TOOL,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleNotFound, type Duties, type RoleService } from "../../../people/index.js";
import type { OfficeInstructions } from "../../application/office-instructions.js";
import type { ProposalService } from "../../application/proposal-service.js";
import type { ProposedChange, ProposedSettingValue } from "../../domain/proposal.js";
import { aProposedCard } from "../../domain/proposal.fixtures.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import {
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_OFFICE_SETUP_TOOL,
  PROPOSE_ROLE_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
} from "../../domain/session-instructions.js";
import { ProposalOfficeTools } from "./proposal-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";

const tester = { role: { key: "tester", card: aProposedCard() } };

/**
 * The tool named `name` as registered, over Proposals that keep what is drafted, refusing with
 * `refusal`.
 */
function toolDrafting(refusal?: string, name = PROPOSE_ROLE_TOOL, instructionsNow = "") {
  const drafted: (ProposedChange | ProposedSettingValue)[] = [];
  const draft = (change: (typeof drafted)[number]) => {
    if (refusal) return Promise.reject(new ProposalRefused([refusal]));
    drafted.push(change);
    return Promise.resolve();
  };
  const proposals = {
    draft: (_sessionId: string, change: ProposedChange) => draft(change),
    draftSetting: (_sessionId: string, proposed: ProposedSettingValue) => draft(proposed),
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
  const [tool] = registry.named([name]);
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

describe("the propose_role tool", () => {
  it("is named as the contracts name it", () => {
    expect(PROPOSE_ROLE_TOOL).toBe(CONTRACT_PROPOSE_ROLE_TOOL);
  });

  it("names the presets a Role is hired from", () => {
    const { tool } = toolDrafting();

    expect(JSON.stringify(z.toJSONSchema(tool.input))).toContain("developer, planner");
  });

  it("drafts a person in a preset's Role, under the name given", async () => {
    const { tool, drafted } = toolDrafting();

    const result = await tool.run({ preset: " developer ", card: { name: "Ada" } }, session);

    expect(result.isError).toBe(false);
    expect(drafted).toEqual([{ kind: "hire-from-preset", roleKey: "developer", name: "Ada" }]);
  });

  it("refuses a preset's Role with more than a name, or with a Role to change", async () => {
    const { tool, drafted } = toolDrafting();

    await expect(
      tool.run({ preset: "developer", card: { name: "Ada", effort: "high" } }, session),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      tool.run({ preset: "developer", card: { name: "Ada" }, skills: [] }, session),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      tool.run({ preset: "developer", role: "tester", card: { name: "Ada" } }, session),
    ).resolves.toEqual({
      text: "Give a preset to hire from or a Role to change, not both.",
      isError: true,
    });
    expect(drafted).toEqual([]);
  });

  it("drafts a new Role on its whole card", async () => {
    const { tool, drafted } = toolDrafting();

    const result = await tool.run({ card: aProposedCard(), skills: ["playwright"] }, session);

    expect(result.isError).toBe(false);
    expect(drafted).toEqual([
      { kind: "hire", card: aProposedCard(), skills: ["playwright"], roleKey: undefined },
    ]);
  });

  it("names what a new Role's card is missing", async () => {
    const { tool, drafted } = toolDrafting();

    const result = await tool.run({ card: { name: "Tess", title: "Tester" } }, session);

    expect(result.isError).toBe(true);
    expect(result.text).toContain("responsibilities");
    expect(drafted).toEqual([]);
  });

  it("drafts a change of the fields that differ, with what the card has now", async () => {
    const { tool, drafted } = toolDrafting();

    await tool.run({ role: "tester", card: { name: "Tess", effort: "high" } }, session);

    expect(drafted).toEqual([
      { kind: "change", roleKey: "tester", from: { effort: "medium" }, to: { effort: "high" } },
    ]);
  });

  it("refuses a change to a Role that isn't there, or to its skills", async () => {
    const { tool, drafted } = toolDrafting();

    await expect(tool.run({ role: "janitor", card: { effort: "high" } }, session)).resolves.toEqual(
      { text: 'The Office has no Role "janitor".', isError: true },
    );
    await expect(
      tool.run({ role: "tester", card: {}, skills: ["playwright"] }, session),
    ).resolves.toMatchObject({ isError: true });
    expect(drafted).toEqual([]);
  });

  it("asks for a first name apart from the title", () => {
    const { tool } = toolDrafting();

    expect(JSON.stringify(z.toJSONSchema(tool.input))).toContain(
      "The person's first name, apart from the Role's title",
    );
  });

  it("refuses a person named by the Role's title, hired from scratch, from a preset or renamed", async () => {
    const { tool, drafted } = toolDrafting();

    await expect(
      tool.run(
        { card: { ...aProposedCard(), name: "Docs Writer", title: "Docs writer" } },
        session,
      ),
    ).resolves.toEqual(namedByTheTitle("Docs Writer"));
    await expect(
      tool.run({ preset: "developer", card: { name: " developer " } }, session),
    ).resolves.toEqual(namedByTheTitle("developer"));
    await expect(
      tool.run({ role: "tester", card: { name: aProposedCard().title } }, session),
    ).resolves.toEqual(namedByTheTitle(aProposedCard().title));
    expect(drafted).toEqual([]);
  });

  it("gives the Agent the reasons a Proposal is refused", async () => {
    const { tool } = toolDrafting("Choose a model the engine offers.");

    await expect(tool.run({ card: aProposedCard() }, session)).resolves.toEqual({
      text: "Choose a model the engine offers.",
      isError: true,
    });
  });
});

describe("the propose_office_setting tool", () => {
  it("is named as the contracts name it", () => {
    expect(PROPOSE_OFFICE_SETTING_TOOL).toBe(CONTRACT_PROPOSE_OFFICE_SETTING_TOOL);
  });

  it("drafts the new value of the setting", async () => {
    const { tool, drafted } = toolDrafting(undefined, PROPOSE_OFFICE_SETTING_TOOL);

    const result = await tool.run({ setting: "office-wide-limit", value: 5 }, session);

    expect(result.isError).toBe(false);
    expect(drafted).toEqual([{ setting: "office-wide-limit", value: 5 }]);
  });

  it("drafts the Office instructions' new text, without the spaces around it", async () => {
    const { tool, drafted } = toolDrafting(undefined, PROPOSE_OFFICE_SETTING_TOOL);

    const result = await tool.run(
      { setting: "office-instructions", text: "\n Keep it short.\nUse plain words. \n" },
      session,
    );

    expect(result.isError).toBe(false);
    expect(drafted).toEqual([
      { setting: "office-instructions", value: "Keep it short.\nUse plain words." },
    ]);
  });

  it("refuses a value that isn't of the setting's type", async () => {
    const { tool, drafted } = toolDrafting(undefined, PROPOSE_OFFICE_SETTING_TOOL);

    await expect(tool.run({ setting: "office-instructions", value: 5 }, session)).resolves.toEqual({
      text: "Give the whole new Office instructions as text, and no value.",
      isError: true,
    });
    await expect(tool.run({ setting: "size-threshold", text: "5" }, session)).resolves.toEqual({
      text: "Give the new size-threshold as value, and no text.",
      isError: true,
    });
    await expect(tool.run({ setting: "office-wide-limit" }, session)).resolves.toMatchObject({
      isError: true,
    });
    expect(drafted).toEqual([]);
  });

  it("drafts new holders for the duties named, a holder of none as null", async () => {
    const { tool, drafted } = toolDrafting(undefined, PROPOSE_OFFICE_SETTING_TOOL);

    const result = await tool.run(
      {
        setting: "duties",
        duties: [
          { duty: "implements", holder: " developer-2 " },
          { duty: "plans", holder: null },
        ],
      },
      session,
    );

    expect(result.isError).toBe(false);
    expect(drafted).toEqual([
      { setting: "duties", value: { implements: "developer-2", plans: null } },
    ]);
  });

  it("refuses duties given wrong", async () => {
    const { tool, drafted } = toolDrafting(undefined, PROPOSE_OFFICE_SETTING_TOOL);
    const giveTheDuties =
      "Give the duties that change as duties, each with its new holder, and no value or text.";

    await expect(tool.run({ setting: "duties", duties: [] }, session)).resolves.toEqual({
      text: giveTheDuties,
      isError: true,
    });
    await expect(tool.run({ setting: "duties" }, session)).resolves.toEqual({
      text: giveTheDuties,
      isError: true,
    });
    const named = [{ duty: "plans", holder: "planner" }];
    await expect(
      tool.run({ setting: "duties", duties: named, value: 3 }, session),
    ).resolves.toEqual({ text: giveTheDuties, isError: true });
    await expect(
      tool.run({ setting: "duties", duties: named, text: "planner" }, session),
    ).resolves.toEqual({ text: giveTheDuties, isError: true });
    await expect(
      tool.run(
        {
          setting: "duties",
          duties: [...named, { duty: "plans", holder: null }],
        },
        session,
      ),
    ).resolves.toEqual({ text: "Name each duty once; plans is named twice.", isError: true });
    await expect(
      tool.run({ setting: "duties", duties: [{ duty: "sweeps", holder: null }] }, session),
    ).resolves.toMatchObject({ text: expect.stringContaining('no duty "sweeps"'), isError: true });
    await expect(
      tool.run({ setting: "size-threshold", value: 60_000, duties: named }, session),
    ).resolves.toEqual({
      text: "Give duties only for the setting duties, not size-threshold.",
      isError: true,
    });
    expect(drafted).toEqual([]);
  });

  it("names each duty with its label", () => {
    const { tool } = toolDrafting(undefined, PROPOSE_OFFICE_SETTING_TOOL);

    const schema = JSON.stringify(z.toJSONSchema(tool.input));

    expect(schema).toContain("implements (Implements)");
    expect(schema).toContain("mcp-tool-consultant (Default Consultant for MCP tool hard switches)");
  });

  it("tells the Agent to give the text whole, from the text now", () => {
    const { tool } = toolDrafting(undefined, PROPOSE_OFFICE_SETTING_TOOL);

    const schema = JSON.stringify(z.toJSONSchema(tool.input));

    expect(schema).toContain("given whole");
    expect(schema).toContain(READ_OFFICE_INSTRUCTIONS_TOOL);
  });

  it("gives the Agent the owner's reasons a Proposal is refused", async () => {
    const { tool } = toolDrafting(
      "The Office-wide limit is 3 already.",
      PROPOSE_OFFICE_SETTING_TOOL,
    );

    await expect(tool.run({ setting: "office-wide-limit", value: 3 }, session)).resolves.toEqual({
      text: "The Office-wide limit is 3 already.",
      isError: true,
    });
  });
});

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
            card: { ...aProposedCard({ name: "Max", title: "Builder" }), roleOverride: null },
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
        { hires: [{ preset: "developer", name: "Ada", card: { effort: "high" } }], duties: [] },
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
