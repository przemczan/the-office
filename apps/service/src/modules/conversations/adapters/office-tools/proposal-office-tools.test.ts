import {
  PROPOSE_OFFICE_SETTING_TOOL as CONTRACT_PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_ROLE_TOOL as CONTRACT_PROPOSE_ROLE_TOOL,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleNotFound, type RoleService } from "../../../people/index.js";
import type { ProposalService } from "../../application/proposal-service.js";
import type { OfficeSetting, ProposedChange } from "../../domain/proposal.js";
import { aProposedCard } from "../../domain/proposal.fixtures.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import {
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_ROLE_TOOL,
} from "../../domain/session-instructions.js";
import { ProposalOfficeTools } from "./proposal-office-tools.js";

const tester = { role: { key: "tester", card: aProposedCard() } };

/**
 * The tool named `name` as registered, over Proposals that keep what is drafted, refusing with
 * `refusal`.
 */
function toolDrafting(refusal?: string, name = PROPOSE_ROLE_TOOL) {
  const drafted: (ProposedChange | { setting: OfficeSetting; value: number })[] = [];
  const draft = (change: (typeof drafted)[number]) => {
    if (refusal) return Promise.reject(new ProposalRefused([refusal]));
    drafted.push(change);
    return Promise.resolve();
  };
  const proposals = {
    draft: (_sessionId: string, change: ProposedChange) => draft(change),
    draftSetting: (_sessionId: string, setting: OfficeSetting, value: number) =>
      draft({ setting, value }),
  } as unknown as ProposalService;
  const roles = {
    read: (key: string) =>
      key === "tester" ? Promise.resolve(tester) : Promise.reject(new RoleNotFound(key)),
    presets: () => [
      { roleKey: "developer", card: { title: "Developer" } },
      { roleKey: "planner", card: { title: "Planner" } },
    ],
  } as unknown as RoleService;
  const registry = new OfficeToolRegistry();
  new ProposalOfficeTools(registry, proposals, roles).onModuleInit();
  const [tool] = registry.named([name]);
  if (!tool) throw new Error(`${name} is not registered.`);
  return { tool, drafted };
}

const session = { sessionId: "session-1" };

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
