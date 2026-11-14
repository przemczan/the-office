import { proposedChangeSchema } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import type { InitiativeEdit, Proposal, ProposedChange } from "../../domain/proposal.js";
import { toProposalResponse } from "./conversation-responses.js";

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
