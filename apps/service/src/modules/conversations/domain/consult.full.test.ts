import { describe, expect, it } from "vitest";
import {
  APPROVAL_OPTIONS,
  approvalQuestion,
  consultantNamed,
  consultationOpening,
  consultationTitle,
  callChain,
  callProblems,
  CALL_STEPS,
  consultDecision,
  passedOnTo,
  type ConsultantPerson,
} from "./consult.js";
import type { Decision } from "./decision.js";
import { aDecision } from "./decision.fixtures.js";

const CTO: ConsultantPerson = { roleKey: "cto", name: "Casey", title: "CTO" };
const DEVOPS: ConsultantPerson = { roleKey: "devops", name: "Dev", title: "Devops" };
const ARCHITECT: ConsultantPerson = { roleKey: "architect", name: "Ari", title: "Architect" };

describe("consultantNamed", () => {
  it.each(["cto", "CTO", " casey "])("finds the Consultant the brief calls %j", (person) => {
    expect(consultantNamed(person, [DEVOPS, CTO], "developer")).toBe(CTO);
  });

  it("finds nobody for no name, an unknown name, or the asking person themselves", () => {
    expect(consultantNamed(undefined, [CTO], "developer")).toBeUndefined();
    expect(consultantNamed("  ", [CTO], "developer")).toBeUndefined();
    expect(consultantNamed("Architect", [CTO], "developer")).toBeUndefined();
    expect(consultantNamed("CTO", [CTO], "cto")).toBeUndefined();
  });
});

describe("consultDecision", () => {
  const consult = {
    kind: "question",
    person: "CTO",
    question: "Which database?",
    context: "The export reads every Project.",
    options: ["SQLite", "Postgres"],
    recommended: 1,
    why: "It is what the Projects use.",
  } as const;

  it("puts the question to a Consultant as the Agent asked it", () => {
    expect(consultDecision(consult, { kind: "consultant", roleKey: "cto" })).toMatchObject({
      question: "Which database?",
      context: "The export reads every Project.",
      recommendation: { option: 1 },
    });
  });

  it("tells the user in whose place they answer", () => {
    expect(consultDecision(consult, { kind: "user" }).context).toBe(
      "For CTO: nobody who can be consulted fills that Role, so you answer in their place.\n\nThe export reads every Project.",
    );
  });

  it("asks approval of a call with the two answers, never an always", () => {
    const draft = consultDecision(
      {
        kind: "approval",
        call: "Install ffmpeg.",
        context: "Needed for video.",
        why: "No other way.",
      },
      { kind: "user" },
    );
    expect(draft.options).toEqual(["Allow once", "Deny"]);
    expect(draft.kind).toBe("approval");
  });
});

describe("callChain", () => {
  it("holds the asker alone outside a Consultation", () => {
    expect(callChain("planner", [])).toEqual({ roleKeys: ["planner"], steps: 0 });
  });

  it("holds every asker and everyone asked up the Consultations, counting who was asked", () => {
    const planners = aDecision({ roleKey: "planner", putTo: "devops" });
    const devops = aDecision({
      roleKey: "devops",
      putTo: "architect",
      passedOn: [{ roleKey: "cto", reason: "Architecture.", passedOnAt: new Date() }],
    });

    expect(callChain("architect", [devops, planners])).toEqual({
      roleKeys: ["architect", "devops", "cto", "planner"],
      steps: 3,
    });
  });
});

describe("callProblems", () => {
  it("lets the first two people down a chain be called", () => {
    expect(callProblems(callChain("planner", []), DEVOPS)).toEqual([]);
    const planners = aDecision({ roleKey: "planner", putTo: "devops" });
    expect(callProblems(callChain("devops", [planners]), CTO)).toEqual([]);
  });

  it("refuses someone already in the chain, naming them", () => {
    const planners = aDecision({ roleKey: "cto", putTo: "devops" });
    expect(callProblems(callChain("devops", [planners]), CTO)).toEqual([
      "Casey is already in this chain of calls: answer from what you have, or pass it on to the user.",
    ]);
  });

  it("refuses a third person down one chain", () => {
    const planners = aDecision({ roleKey: "planner", putTo: "devops" });
    const devops = aDecision({ roleKey: "devops", putTo: "cto" });
    expect(callProblems(callChain("cto", [devops, planners]), ARCHITECT)).toEqual([
      `This chain of calls has asked ${CALL_STEPS} people already, the most it may: answer from what you have, or pass it on to the user.`,
    ]);
  });
});

/** The chain a pass-on of `decision` is in, with the Decisions above it. */
function chainOf(decision: Decision, above: readonly Decision[] = []) {
  return callChain(decision.roleKey, [decision, ...above]);
}

describe("passedOnTo", () => {
  const approval = aDecision({
    kind: "approval",
    roleKey: "developer",
    question: approvalQuestion("Install ffmpeg."),
    options: [...APPROVAL_OPTIONS],
    putTo: "devops",
  });

  it("finds the Consultant the first passer names", () => {
    expect(passedOnTo(approval, "CTO", [DEVOPS, CTO], chainOf(approval))).toEqual({
      kind: "consultant",
      consultant: CTO,
    });
  });

  it("gives the step past the chain's last to the user", () => {
    const passedOnce = aDecision({
      ...approval,
      putTo: "cto",
      passedOn: [{ roleKey: "devops", reason: "Architecture.", passedOnAt: new Date() }],
    });
    expect(
      passedOnTo(passedOnce, "Architect", [DEVOPS, CTO, ARCHITECT], chainOf(passedOnce)),
    ).toEqual({ kind: "user" });
  });

  it("counts a nested call as a step: a Consultant asked by one passes on to the user", () => {
    const planners = aDecision({ roleKey: "planner", putTo: "devops" });
    const devopsApproval = aDecision({ ...approval, roleKey: "devops", putTo: "cto" });
    expect(
      passedOnTo(
        devopsApproval,
        "Architect",
        [CTO, ARCHITECT],
        chainOf(devopsApproval, [planners]),
      ),
    ).toEqual({ kind: "user" });
  });

  it("gives it to the user for nobody named, or someone not hired", () => {
    expect(passedOnTo(approval, undefined, [CTO], chainOf(approval))).toEqual({ kind: "user" });
    expect(passedOnTo(approval, "Architect", [CTO], chainOf(approval))).toEqual({ kind: "user" });
  });

  it("refuses passing it on to someone already in the chain, naming them", () => {
    const askedByTheCto = aDecision({ ...approval, roleKey: "cto" });
    expect(passedOnTo(askedByTheCto, "CTO", [DEVOPS, CTO], chainOf(askedByTheCto))).toEqual({
      kind: "refused",
      problems: [
        "Casey is already in this chain of calls: answer from what you have, or pass it on to the user.",
      ],
    });
  });

  it("gives The Office's own Decision to the user", () => {
    const offices = aDecision({ roleKey: undefined, putTo: "cto" });
    expect(passedOnTo(offices, "Devops", [DEVOPS], chainOf(offices))).toEqual({ kind: "user" });
  });
});

describe("a request", () => {
  it("opens a Decision of its own kind, with no options, why it is needed as its reason", () => {
    expect(
      consultDecision(
        {
          kind: "request",
          person: "Devops",
          request: "Set up the Project's commands.",
          context: "The user asked for it.",
          why: "Only Devops drafts Project commands.",
        },
        { kind: "consultant", roleKey: "devops" },
      ),
    ).toEqual({
      kind: "request",
      question: "Set up the Project's commands.",
      context: "The user asked for it.",
      options: [],
      recommendation: { option: 0, reason: "Only Devops drafts Project commands." },
    });
  });

  it("opens its Consultation asking the callee to do it with their own tools, in words", () => {
    const opening = consultationOpening(
      aDecision({
        kind: "request",
        taskId: undefined,
        question: "Set up the Project's commands.",
        options: [],
        recommendation: { option: 0, reason: "Only Devops drafts them." },
      }),
      "Angela",
    );

    expect(opening).toContain("Angela asks you to: Set up the Project's commands.");
    expect(opening).toContain("Why they need it: Only Devops drafts them.");
    expect(opening).toContain("Do it with your own tools, then answer");
    expect(opening).not.toContain("on this Task");
  });
});

describe("a Consultation", () => {
  it("is titled with both people", () => {
    expect(consultationTitle("Dana", "Casey")).toBe("Consultation · Dana and Casey");
  });

  it("opens by asking the Consultant the Decision, with its options and the recommended one", () => {
    const opening = consultationOpening(
      aDecision({ question: "Which database?", options: ["SQLite", "Postgres"] }),
      "Dana",
    );

    expect(opening).toContain("Dana asks for your answer");
    expect(opening).toContain("Question: Which database?");
    expect(opening).toContain("1. SQLite (recommended)\n2. Postgres");
  });

  it("says who passed an approval on and why, and that it can be passed on again", () => {
    const opening = consultationOpening(
      aDecision({
        kind: "approval",
        question: approvalQuestion("Install ffmpeg."),
        options: [...APPROVAL_OPTIONS],
      }),
      "Dana",
      [{ name: "Dev", reason: "It changes the build machine for every Project." }],
    );

    expect(opening).toContain(
      "Dev passed it on to you: It changes the build machine for every Project.",
    );
    expect(opening).toContain("or pass it on");
  });
});
