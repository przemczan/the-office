import { PROPOSE_ROLE_TOOL as CONTRACT_PROPOSE_ROLE_TOOL } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleNotFound, type RoleService } from "../../../people/index.js";
import type { ProposalService } from "../../application/proposal-service.js";
import type { ProposedChange } from "../../domain/proposal.js";
import { aProposedCard } from "../../domain/proposal.fixtures.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import { PROPOSE_ROLE_TOOL } from "../../domain/session-instructions.js";
import { ProposalOfficeTools } from "./proposal-office-tools.js";

const tester = { role: { key: "tester", card: aProposedCard() } };

/** The tool as registered, over Proposals that keep what is drafted, refusing with `refusal`. */
function toolDrafting(refusal?: string) {
  const drafted: ProposedChange[] = [];
  const proposals = {
    draft: (_sessionId: string, change: ProposedChange) => {
      if (refusal) return Promise.reject(new ProposalRefused([refusal]));
      drafted.push(change);
      return Promise.resolve();
    },
  } as unknown as ProposalService;
  const roles = {
    read: (key: string) =>
      key === "tester" ? Promise.resolve(tester) : Promise.reject(new RoleNotFound(key)),
  } as unknown as RoleService;
  const registry = new OfficeToolRegistry();
  new ProposalOfficeTools(registry, proposals, roles).onModuleInit();
  const [tool] = registry.named([PROPOSE_ROLE_TOOL]);
  if (!tool) throw new Error("propose_role is not registered.");
  return { tool, drafted };
}

const session = { sessionId: "session-1" };

describe("the propose_role tool", () => {
  it("is named as the contracts name it", () => {
    expect(PROPOSE_ROLE_TOOL).toBe(CONTRACT_PROPOSE_ROLE_TOOL);
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

  it("gives the Agent the reasons a Proposal is refused", async () => {
    const { tool } = toolDrafting("Choose a model the engine offers.");

    await expect(tool.run({ card: aProposedCard() }, session)).resolves.toEqual({
      text: "Choose a model the engine offers.",
      isError: true,
    });
  });
});
