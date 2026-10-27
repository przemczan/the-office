import { describe, expect, it } from "vitest";
import { ProposalApplied, ProposalDeclined, ProposalDrafted } from "./conversation-events.js";
import {
  changeToApply,
  proposedChangeProblems,
  proposedRoleChange,
  type ProposedChange,
} from "./proposal.js";
import { aProposal, aProposedCard } from "./proposal.fixtures.js";
import { applyProposal, declineProposal } from "./proposal-changes.js";
import { ProposalRefused } from "./proposal-refused.js";
import { aThread } from "./thread.fixtures.js";
import { draftProposal } from "./thread-changes.js";

const AT = new Date("2026-10-27T10:00:00.000Z");
const thread = aThread({
  home: { kind: "chat", roleKey: "office-manager" },
  roleKey: "office-manager",
});
const hire: ProposedChange = {
  kind: "hire",
  card: aProposedCard(),
  skills: [],
  roleKey: undefined,
};

describe("drafting a Proposal", () => {
  it("logs its card, open, drafted by the Thread's person", () => {
    const {
      thread: drafted,
      logged,
      proposal,
      event,
    } = draftProposal(thread, {
      id: "p-1",
      draftedAt: AT,
      change: hire,
    });

    expect(proposal).toEqual({
      id: "p-1",
      threadId: thread.id,
      draftedBy: "office-manager",
      draftedAt: AT,
      change: hire,
      status: { kind: "open" },
    });
    expect(logged).toEqual([
      {
        kind: "proposal",
        id: expect.any(String),
        threadId: thread.id,
        at: AT,
        roleKey: "office-manager",
        proposalId: "p-1",
      },
    ]);
    expect(drafted).toBe(thread);
    expect(event).toBeInstanceOf(ProposalDrafted);
  });

  it("refuses a change that changes nothing", () => {
    const change = proposedRoleChange("developer", aProposedCard(), { name: "Tess" });

    expect(proposedChangeProblems(change)).toHaveLength(1);
    expect(() => draftProposal(thread, { id: "p-1", draftedAt: AT, change })).toThrow(
      ProposalRefused,
    );
  });
});

describe("a change to a Role", () => {
  it("keeps only the fields that differ, with what the card had", () => {
    const card = aProposedCard();
    const capabilities = { ...card.capabilities, sharedMemory: true };

    expect(
      proposedRoleChange("tester", card, {
        name: "Tess",
        effort: "high",
        // The same switches, in another order, as a stored card may have them.
        hardSwitches: {
          changeRoles: { kind: "never" },
          runInstalls: { kind: "never" },
          publishOutsideThePipeline: { kind: "never" },
        },
        capabilities,
      }),
    ).toEqual({
      kind: "change",
      roleKey: "tester",
      from: { effort: "medium", capabilities: card.capabilities },
      to: { effort: "high", capabilities },
    });
  });
});

describe("applying a Proposal", () => {
  it("applies it as drafted, or a new Role as the user edited it", () => {
    const edited = { card: aProposedCard({ name: "Tom" }), skills: ["playwright"] };

    expect(changeToApply(aProposal(), undefined)).toEqual(aProposal().change);
    expect(changeToApply(aProposal(), edited)).toEqual({
      kind: "hire",
      card: edited.card,
      skills: ["playwright"],
      roleKey: undefined,
    });
  });

  it("refuses an edited card for a change to a Role", () => {
    const change = proposedRoleChange("tester", aProposedCard(), { effort: "high" });
    const edited = { card: aProposedCard(), skills: [] };

    expect(() => changeToApply(aProposal({ change }), edited)).toThrow(
      "Only a new Role's card is edited before hiring.",
    );
  });

  it("records it applied, as carried out", () => {
    const applied: ProposedChange = { ...hire, roleKey: "tester" };

    const { proposal, event } = applyProposal(aProposal(), thread, applied, AT);

    expect(proposal).toMatchObject({ change: applied, status: { kind: "applied", at: AT } });
    expect(event).toBeInstanceOf(ProposalApplied);
  });

  it("refuses once it is applied or declined", () => {
    const applied = aProposal({ status: { kind: "applied", at: AT } });
    const declined = aProposal({ status: { kind: "declined", at: AT } });

    expect(() => changeToApply(applied, undefined)).toThrow("This Proposal is applied already.");
    expect(() => changeToApply(declined, undefined)).toThrow("This Proposal was declined.");
    expect(() => declineProposal(applied, thread, AT)).toThrow(ProposalRefused);
  });
});

describe("declining a Proposal", () => {
  it("records it declined and changes nothing else", () => {
    const { proposal, event } = declineProposal(aProposal(), thread, AT);

    expect(proposal).toEqual({ ...aProposal(), status: { kind: "declined", at: AT } });
    expect(event).toBeInstanceOf(ProposalDeclined);
  });
});
