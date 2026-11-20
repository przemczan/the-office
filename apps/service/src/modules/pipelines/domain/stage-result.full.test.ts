import { describe, expect, it } from "vitest";
import { readStageResult } from "./stage-result.js";

/** A Decision the Agent opened with an Office tool. */
const asked = {
  question: "Which page?",
  context: "Both list devices.",
  options: ["The device page", "The list"],
  recommendation: { option: 1, reason: "Users look there first." },
};

/** How many statements the Task's Definition of Done has. */
const STATEMENTS = 3;

describe("readStageResult", () => {
  it("reads the screenshots a result lists", () => {
    expect(
      readStageResult(
        {
          status: "done",
          summary: "Built.",
          handoverNote: "All set.",
          definitionOfDoneMet: [1],
          screenshots: ["dialog/open.png", "home.png"],
        },
        undefined,
        STATEMENTS,
      ),
    ).toMatchObject({ valid: true, screenshots: ["dialog/open.png", "home.png"] });
  });

  it("reads the statements out of reach, with why, and leaves them out when none is listed", () => {
    const outOfReach = [{ statement: 3, why: "It runs on the user's workstation." }];
    const done = {
      status: "done",
      summary: "Built.",
      handoverNote: "All set.",
      definitionOfDoneMet: [1],
    };

    expect(
      readStageResult({ ...done, definitionOfDoneOutOfReach: outOfReach }, undefined, STATEMENTS),
    ).toMatchObject({ valid: true, outcome: { ...done, definitionOfDoneOutOfReach: outOfReach } });
    const listedNone = readStageResult(
      { ...done, definitionOfDoneOutOfReach: [] },
      undefined,
      STATEMENTS,
    );
    expect(listedNone.valid && !listedNone.handingOver && listedNone.outcome).not.toHaveProperty(
      "definitionOfDoneOutOfReach",
    );
  });

  it("asks to correct a statement out of reach that is also met, or that the Definition of Done doesn't have", () => {
    const done = { status: "done", summary: "Built.", handoverNote: "All set." };

    expect(
      readStageResult(
        {
          ...done,
          definitionOfDoneMet: [1, 2],
          definitionOfDoneOutOfReach: [{ statement: 2, why: "No access." }],
        },
        undefined,
        STATEMENTS,
      ),
    ).toEqual({
      valid: false,
      problems:
        '"definitionOfDoneMet" and "definitionOfDoneOutOfReach" both name statement 2: a statement you can\'t verify isn\'t met, so list it only as out of reach.',
    });
    expect(
      readStageResult(
        {
          ...done,
          definitionOfDoneMet: [],
          definitionOfDoneOutOfReach: [
            { statement: 4, why: "No access." },
            { statement: 5, why: "No access." },
          ],
        },
        undefined,
        STATEMENTS,
      ),
    ).toEqual({
      valid: false,
      problems:
        '"definitionOfDoneOutOfReach" names statements 4, 5, which the Definition of Done doesn\'t have: it has 3.',
    });
  });

  it("needs the Decision the Agent opened with a tool, keeping the Handover note and no screenshots, whatever the status", () => {
    const outcome = { status: "needs-decision", ...asked, handoverNote: "Waiting." };

    expect(
      readStageResult(
        { status: "needs_decision", summary: "Asked.", handoverNote: "Waiting." },
        asked,
        STATEMENTS,
      ),
    ).toEqual({ valid: true, outcome, screenshots: [] });
    expect(
      readStageResult(
        {
          status: "done",
          summary: "Built.",
          handoverNote: "Waiting.",
          definitionOfDoneMet: [],
          screenshots: ["home.png"],
        },
        asked,
        STATEMENTS,
      ),
    ).toEqual({ valid: true, outcome, screenshots: [] });
    expect(readStageResult(undefined, asked, STATEMENTS)).toEqual({
      valid: true,
      outcome: { status: "needs-decision", ...asked },
      screenshots: [],
    });
  });
});
