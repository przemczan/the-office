import { describe, expect, it } from "vitest";
import {
  APPROVAL_OPTIONS,
  approvalQuestion,
  consultantNamed,
  consultationOpening,
  consultationTitle,
  consultDecision,
  isApproval,
  passedOnTo,
  type ConsultantPerson,
} from "./consult.js";
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
  });
});

describe("passedOnTo", () => {
  const approval = aDecision({
    roleKey: "developer",
    question: approvalQuestion("Install ffmpeg."),
    options: [...APPROVAL_OPTIONS],
    putTo: "devops",
  });

  it("finds the Consultant the first passer names", () => {
    expect(passedOnTo(approval, "CTO", [DEVOPS, CTO])).toBe(CTO);
  });

  it("gives the second step up to the user", () => {
    const passedOnce = aDecision({
      ...approval,
      putTo: "cto",
      passedOn: [{ roleKey: "devops", reason: "Architecture.", passedOnAt: new Date() }],
    });
    expect(passedOnTo(passedOnce, "Architect", [DEVOPS, CTO, ARCHITECT])).toBeUndefined();
  });

  it("gives it to the user for nobody named, someone not hired, or someone already asked", () => {
    expect(passedOnTo(approval, undefined, [CTO])).toBeUndefined();
    expect(passedOnTo(approval, "Architect", [CTO])).toBeUndefined();
    expect(passedOnTo(approval, "Devops", [DEVOPS, CTO])).toBeUndefined();
    const askedByTheCto = aDecision({ ...approval, roleKey: "cto" });
    expect(passedOnTo(askedByTheCto, "CTO", [DEVOPS, CTO])).toBeUndefined();
  });
});

describe("isApproval", () => {
  it("tells an approval of a call from a question", () => {
    expect(
      isApproval({
        question: approvalQuestion("Install ffmpeg."),
        context: "",
        options: [...APPROVAL_OPTIONS],
        recommendation: { option: 0, reason: "" },
      }),
    ).toBe(true);
    expect(isApproval(aDecision({ options: [...APPROVAL_OPTIONS] }))).toBe(false);
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
      aDecision({ question: approvalQuestion("Install ffmpeg."), options: [...APPROVAL_OPTIONS] }),
      "Dana",
      [{ name: "Dev", reason: "It changes the build machine for every Project." }],
    );

    expect(opening).toContain(
      "Dev passed it on to you: It changes the build machine for every Project.",
    );
    expect(opening).toContain("or pass it on");
  });
});
