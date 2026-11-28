import { describe, expect, it } from "vitest";
import {
  APPROVAL_OPTIONS,
  approvalQuestion,
  consultantNamed,
  consultationOpening,
  consultationTitle,
  callChain,
  callProblems,
  consultantAnswerProblems,
  consultationAskedLine,
  CALL_STEPS,
  consultDecision,
  passedOnTo,
  type ConsultantPerson,
} from "./consult.js";
import {
  oneOptionAnswer,
  oneWordsAnswer,
  type Decision,
  type DecisionQuestion,
} from "./decision.js";
import { aDecision, THREE_QUESTIONS } from "./decision.fixtures.js";

/** An approval of installing ffmpeg, by The Office's two answers. */
function anApproval(fields: Partial<Decision> = {}): Decision {
  return aDecision({
    kind: "approval",
    questions: [
      {
        kind: "choice",
        question: approvalQuestion("Install ffmpeg."),
        options: APPROVAL_OPTIONS,
        recommendation: { option: 0, reason: "Needed for video." },
      },
    ],
    ...fields,
  });
}

const DATABASE: DecisionQuestion = {
  kind: "choice",
  question: "Which database?",
  options: ["SQLite", "Postgres"],
  recommendation: { option: 0, reason: "It needs no server." },
};

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
    kind: "form",
    person: "CTO",
    context: "The export reads every Project.",
    questions: THREE_QUESTIONS,
  } as const;

  it("puts the form to a Consultant as the Agent asked it", () => {
    expect(consultDecision(consult, { kind: "consultant", roleKey: "cto" }, "Jim")).toEqual({
      kind: "form",
      context: "The export reads every Project.",
      questions: THREE_QUESTIONS,
    });
  });

  it("tells the user in whose place they answer", () => {
    expect(consultDecision(consult, { kind: "user" }, "Jim").context).toBe(
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
      "Jim",
    );
    expect(draft).toEqual({
      kind: "approval",
      context: "Needed for video.",
      questions: [
        {
          kind: "choice",
          question: approvalQuestion("Install ffmpeg."),
          options: ["Allow once", "Deny"],
          recommendation: { option: 0, reason: "No other way." },
        },
      ],
    });
  });

  it("asks approval of a held call in plain words, keeping its key apart", () => {
    const heldCall = {
      key: '{"action":"start_task","input":{"taskId":"t1"}}',
      action: "Start a Task",
      description: "Starts the Task.",
      subject: { kind: "task", id: "t1", title: "Fix it" },
      input: { taskId: "t1" },
      callAsSent: { action: "start_task", input: { taskId: "t1" } },
    };
    const draft = consultDecision(
      { kind: "approval", call: heldCall.key, context: "c", why: "w", heldCall },
      { kind: "user" },
      "Angela",
    );
    expect(draft.questions[0]).toMatchObject({
      question: "Allow Angela to Start a Task?",
      heldCall,
    });
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
  const approval = anApproval({ roleKey: "developer", putTo: "devops" });

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
  it("opens a Decision of its own kind, one open question with why it is needed", () => {
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
        "Jim",
      ),
    ).toEqual({
      kind: "request",
      context: "The user asked for it.",
      questions: [
        {
          kind: "open",
          question: "Set up the Project's commands.",
          why: "Only Devops drafts Project commands.",
        },
      ],
    });
  });

  it("opens its Consultation asking the callee to do it with their own tools, in words", () => {
    const opening = consultationOpening(
      aDecision({
        kind: "request",
        taskId: undefined,
        questions: [
          {
            kind: "open",
            question: "Set up the Project's commands.",
            why: "Only Devops drafts them.",
          },
        ],
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
    const opening = consultationOpening(aDecision({ questions: [DATABASE] }), "Dana");

    expect(opening).toContain("Dana asks for your answer");
    expect(opening).toContain("Question 1: Which database?\n1. SQLite (recommended)\n2. Postgres");
    expect(opening).toContain("Why they recommend it: It needs no server.");
  });

  it("lists every question of a form in order, and how to submit it or ask again", () => {
    const decision = aDecision({ questions: THREE_QUESTIONS });
    const opening = consultationOpening(decision, "Dana");

    expect(opening).toContain(
      [
        "Their questions:",
        "",
        "Question 1: Should the export include archived Projects?",
        "1. Only active Projects (recommended)",
        "2. Every Project",
        "Why they recommend it: Archived Projects have nothing to export.",
        "",
        "Question 2: Which years should it cover?",
        "An open question: answer in your own words.",
        "",
        "Question 3: Which format?",
        "1. CSV",
        "2. JSON (recommended)",
        "Why they recommend it: It keeps the nesting.",
      ].join("\n"),
    );
    expect(opening).toContain("`generalComment`");
    expect(opening).toContain("`askAgain`");
    expect(consultationAskedLine("Dana", decision)).toBe(
      "Dana asks: Should the export include archived Projects? (and 2 more questions)",
    );
  });

  it("opens The Office's own Decision with the user's options, which stay theirs", () => {
    const opening = consultationOpening(aDecision({ roleKey: undefined }), "The Office");

    expect(opening).toContain("Question: Should the export include archived Projects?");
    expect(opening).toContain(
      "The user's options, which stay theirs:\n1. Only active Projects\n2. Every Project",
    );
  });

  it("says who passed an approval on and why, and that it can be passed on again", () => {
    const opening = consultationOpening(anApproval(), "Dana", [
      { name: "Dev", reason: "It changes the build machine for every Project." },
    ]);

    expect(opening).toContain(
      "Dev passed it on to you: It changes the build machine for every Project.",
    );
    expect(opening).toContain("or pass it on");
  });
});

describe("consultantAnswerProblems", () => {
  const theOffices = aDecision({ roleKey: undefined, putTo: "cto" });
  const refusal = [
    "Its options are the user's. Answer in your own words to send the Task back for one more round with them as its guidance, or pass it on to the user.",
  ];

  it("takes words on The Office's own Decision and refuses an option, which stays the user's", () => {
    expect(consultantAnswerProblems(theOffices, oneWordsAnswer("Retry with more time."))).toEqual(
      [],
    );
    expect(consultantAnswerProblems(theOffices, oneOptionAnswer(0))).toEqual(refusal);
    expect(
      consultantAnswerProblems(theOffices, {
        kind: "submitted",
        answers: [{ kind: "option", option: 1, comment: "Then fix it." }],
      }),
    ).toEqual(refusal);
  });

  it("adds nothing to the rules of an Agent's own form", () => {
    expect(consultantAnswerProblems(aDecision({ putTo: "cto" }), oneOptionAnswer(0))).toEqual([]);
  });
});
