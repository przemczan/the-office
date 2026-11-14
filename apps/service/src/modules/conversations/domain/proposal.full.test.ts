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
import { ANN_LEE } from "./user.fixtures.js";

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
  it("applies a preset's Role under the name the user gave", () => {
    const change: ProposedChange = { kind: "hire-from-preset", roleKey: "developer", name: "Ada" };

    expect(
      changeToApply(aProposal({ change }), { kind: "hire-from-preset", name: "Grace" }),
    ).toEqual({ kind: "hire-from-preset", roleKey: "developer", name: "Grace" });
  });

  it("refuses an edit of anything but a new Role, or of another kind of hire", () => {
    const change = proposedRoleChange("tester", aProposedCard(), { effort: "high" });
    const edited = { kind: "hire", card: aProposedCard(), skills: [] } as const;
    const refusal = "Only a new Role is edited before hiring, as it was proposed.";

    expect(() => changeToApply(aProposal({ change }), edited)).toThrow(refusal);
    expect(() => changeToApply(aProposal(), { kind: "hire-from-preset", name: "Grace" })).toThrow(
      refusal,
    );
  });

  it("applies the set-up of The Office as drafted, refusing an edit of its hires", () => {
    const change: ProposedChange = {
      kind: "office-setup",
      hires: [{ kind: "hire-from-preset", roleKey: "planner", name: "Jan" }],
      duties: [{ duty: "reviews", from: "reviewer", to: "planner" }],
      hiredKeys: undefined,
    };

    expect(changeToApply(aProposal({ change }), undefined)).toBe(change);
    expect(() =>
      changeToApply(aProposal({ change }), { kind: "hire-from-preset", name: "Ola" }),
    ).toThrow("Only a new Role is edited before hiring, as it was proposed.");
  });

  it("records it applied, as carried out, by the user who applied it", () => {
    const applied: ProposedChange = { ...hire, roleKey: "tester" };

    const { proposal, event } = applyProposal(aProposal(), thread, applied, AT, ANN_LEE);

    expect(proposal).toMatchObject({
      change: applied,
      status: { kind: "applied", at: AT, by: ANN_LEE },
    });
    expect(event).toBeInstanceOf(ProposalApplied);
  });
});

describe("declining a Proposal", () => {
  it("records it declined, by the user who declined it, and changes nothing else", () => {
    const { proposal, event } = declineProposal(aProposal(), thread, AT, ANN_LEE);

    expect(proposal).toEqual({ ...aProposal(), status: { kind: "declined", at: AT, by: ANN_LEE } });
    expect(event).toBeInstanceOf(ProposalDeclined);
  });
});
