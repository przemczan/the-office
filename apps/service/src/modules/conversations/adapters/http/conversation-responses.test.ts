import { decisionSchema, proposalStatusSchema, proposedChangeSchema } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { aDecision } from "../../domain/decision.fixtures.js";
import type { InitiativeEdit, Proposal, ProposedChange } from "../../domain/proposal.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
import { toDecisionResponse, toProposalResponse } from "./conversation-responses.js";

function aProposalOf(edit: InitiativeEdit): Proposal {
  return aProposalChanging({ kind: "initiative", initiativeId: "initiative-1", edit });
}

function aProposalChanging(change: ProposedChange): Proposal {
  return {
    id: "proposal-1",
    threadId: "thread-1",
    draftedBy: "cto",
    draftedAt: new Date("2026-11-06T10:00:00.000Z"),
    change,
    status: { kind: "open" },
  };
}

describe("toProposalResponse", () => {
  it("answers a new Task drafted before it could have a Description as having none", () => {
    const response = toProposalResponse(
      aProposalOf({
        kind: "add-task",
        title: "Queue schema",
        projectId: "api",
        priority: "normal",
        blockedBy: [],
        taskId: undefined,
      }),
    );

    expect(response.change).toMatchObject({
      edit: { kind: "add-task", description: "", taskId: null },
    });
  });

  it("answers the duties a Proposal names, each with its holder then and as proposed", () => {
    const change: ProposedChange = {
      kind: "duties",
      from: { plans: "planner", reviews: "reviewer" },
      to: { plans: "tester", reviews: null },
    };

    const response = toProposalResponse(aProposalChanging(change));

    expect(response.change).toEqual(change);
    expect(proposedChangeSchema.parse(response.change)).toEqual(change);
  });
});

describe("the user a record names, as the web reads it", () => {
  const answeredAt = new Date("2026-11-06T11:00:00.000Z");

  it("names the user who answered a Decision, any user, and none before users existed", () => {
    const byBen = aDecision({ answer: { kind: "option", option: 1, answeredAt, user: BEN_ITO } });
    const before = aDecision({ answer: { kind: "option", option: 0, answeredAt, user: null } });

    expect(decisionSchema.parse(toDecisionResponse(byBen))).toMatchObject({
      answer: { kind: "option", option: 1 },
      answeredByUser: BEN_ITO,
      answeredBy: null,
      atUsersRequest: null,
    });
    expect(decisionSchema.parse(toDecisionResponse(before)).answeredByUser).toBeNull();
  });

  it("names the user who asked a person to answer for them, as the one who answered", () => {
    const atUsersRequest = { roleKey: "cto", threadId: crypto.randomUUID(), user: ANN_LEE };
    const decision = aDecision({
      answer: { kind: "free-answer", text: "Every Project.", answeredAt, atUsersRequest },
    });

    expect(decisionSchema.parse(toDecisionResponse(decision))).toMatchObject({
      answeredByUser: null,
      atUsersRequest,
    });
  });

  it("names the user who applied or declined a Proposal", () => {
    const edit: InitiativeEdit = { kind: "outcome", outcome: "Writes survive going offline." };
    const applied: Proposal = {
      ...aProposalOf(edit),
      status: { kind: "applied", at: answeredAt, by: ANN_LEE },
    };
    const declined: Proposal = {
      ...aProposalOf(edit),
      status: { kind: "declined", at: answeredAt, by: BEN_ITO },
    };

    expect(proposalStatusSchema.parse(toProposalResponse(applied).status)).toEqual({
      kind: "applied",
      at: answeredAt.toISOString(),
      by: ANN_LEE,
    });
    expect(proposalStatusSchema.parse(toProposalResponse(declined).status)).toEqual({
      kind: "declined",
      at: answeredAt.toISOString(),
      by: BEN_ITO,
    });
  });
});
