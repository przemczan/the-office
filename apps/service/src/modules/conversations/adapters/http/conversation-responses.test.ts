import { decisionSchema, proposalStatusSchema, proposedChangeSchema } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { decideContext } from "../../domain/context-policy.js";
import { aContinuation } from "../../domain/context-policy.fixtures.js";
import { oneOptionAnswer, oneWordsAnswer } from "../../domain/decision.js";
import { aDecision, THREE_QUESTIONS } from "../../domain/decision.fixtures.js";
import { aThread } from "../../domain/thread.fixtures.js";
import type { InitiativeEdit, Proposal, ProposedChange } from "../../domain/proposal.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
import {
  toDecisionResponse,
  toProposalResponse,
  toThreadResponse,
} from "./conversation-responses.js";

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

describe("toThreadResponse", () => {
  it("offers the Thread's skill commands but one an Office command's name takes", () => {
    const response = toThreadResponse(
      aThread(),
      {
        context: decideContext(aContinuation(5, 12_000)),
        contextReported: true,
        changesAllowed: undefined,
        skillCommands: [
          { name: "help", description: "Helps with the release." },
          { name: "release-notes", description: "Writes the release notes." },
        ],
      },
      undefined,
    );

    expect(response.skillCommands).toEqual([
      { name: "release-notes", description: "Writes the release notes." },
    ]);
  });
});

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

describe("a Decision as the web reads it", () => {
  it("gives a form of several questions whole, and as one question for the web until it reads the form", () => {
    const decision = aDecision({
      questions: THREE_QUESTIONS,
      answer: {
        kind: "submitted",
        answers: [
          { kind: "option", option: 1, comment: "Archived ones too." },
          { kind: "words", text: "This year." },
          { kind: "option", option: 0 },
        ],
        generalComment: "Thanks.",
        answeredAt: new Date("2026-11-06T11:00:00.000Z"),
      },
    });

    const response = decisionSchema.parse(toDecisionResponse(decision));

    expect(response).toMatchObject({
      questions: THREE_QUESTIONS,
      formAnswer: {
        kind: "submitted",
        answers: [
          { kind: "option", option: 1, comment: "Archived ones too." },
          { kind: "words", text: "This year." },
          { kind: "option", option: 0 },
        ],
        generalComment: "Thanks.",
      },
      question: "Should the export include archived Projects? (and 2 more questions)",
      options: ["Only active Projects", "Every Project"],
      recommendation: { option: 0, reason: "Archived Projects have nothing to export." },
      answer: { kind: "free-answer", text: expect.stringContaining("General comment: Thanks.") },
    });
  });

  it("gives an open one's answer as null, and an open question's options as none", () => {
    const decision = aDecision({ questions: [{ kind: "open", question: "Which years?" }] });

    expect(decisionSchema.parse(toDecisionResponse(decision))).toMatchObject({
      question: "Which years?",
      options: [],
      recommendation: { option: 0, reason: "" },
      formAnswer: null,
      answer: null,
    });
  });
});

describe("the user a record names, as the web reads it", () => {
  const answeredAt = new Date("2026-11-06T11:00:00.000Z");

  it("names the user who answered a Decision, any user, and none before users existed", () => {
    const byBen = aDecision({ answer: { ...oneOptionAnswer(1), answeredAt, user: BEN_ITO } });
    const before = aDecision({ answer: { ...oneOptionAnswer(0), answeredAt, user: null } });

    expect(decisionSchema.parse(toDecisionResponse(byBen))).toMatchObject({
      formAnswer: oneOptionAnswer(1),
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
      answer: { ...oneWordsAnswer("Every Project."), answeredAt, atUsersRequest },
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
