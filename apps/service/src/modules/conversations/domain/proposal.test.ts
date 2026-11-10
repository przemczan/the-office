import { describe, expect, it } from "vitest";
import { changeToApply } from "./proposal.js";
import { aProposal, aProposedCard } from "./proposal.fixtures.js";
import { declineProposal } from "./proposal-changes.js";
import { ProposalRefused } from "./proposal-refused.js";
import { aThread } from "./thread.fixtures.js";

const AT = new Date("2026-10-27T10:00:00.000Z");
const thread = aThread({
  home: { kind: "chat", roleKey: "office-manager" },
  roleKey: "office-manager",
});

describe("applying a Proposal", () => {
  it("applies it as drafted, or a new Role as the user edited it", () => {
    const edited = {
      kind: "hire",
      card: aProposedCard({ name: "Tom" }),
      skills: ["playwright"],
    } as const;

    expect(changeToApply(aProposal(), undefined)).toEqual(aProposal().change);
    expect(changeToApply(aProposal(), edited)).toEqual({
      kind: "hire",
      card: edited.card,
      skills: ["playwright"],
      roleKey: undefined,
    });
  });

  it("refuses once it is applied or declined", () => {
    const applied = aProposal({ status: { kind: "applied", at: AT } });
    const declined = aProposal({ status: { kind: "declined", at: AT } });

    expect(() => changeToApply(applied, undefined)).toThrow("This Proposal is applied already.");
    expect(() => changeToApply(declined, undefined)).toThrow("This Proposal was declined.");
    expect(() => declineProposal(applied, thread, AT)).toThrow(ProposalRefused);
  });
});
