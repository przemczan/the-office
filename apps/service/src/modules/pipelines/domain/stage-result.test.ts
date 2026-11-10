import { describe, expect, it } from "vitest";
import { readStageResult, STAGE_RESULT_SCHEMA } from "./stage-result.js";

/** How many statements the Task's Definition of Done has. */
const STATEMENTS = 3;

describe("STAGE_RESULT_SCHEMA", () => {
  it("is flat, and requires the Handover note and the Definition of Done report only when done", () => {
    expect(STAGE_RESULT_SCHEMA).toMatchObject({
      type: "object",
      required: ["status", "summary"],
      if: { properties: { status: { const: "done" } } },
    });
    expect(STAGE_RESULT_SCHEMA["then"]).toEqual({
      required: ["handoverNote", "definitionOfDoneMet"],
    });
    expect(STAGE_RESULT_SCHEMA).not.toHaveProperty("allOf");
    expect(Object.keys(STAGE_RESULT_SCHEMA["properties"] as object)).toEqual([
      "status",
      "summary",
      "handoverNote",
      "definitionOfDoneMet",
      "definitionOfDoneOutOfReach",
      "failureReason",
      "screenshots",
    ]);
    expect(STAGE_RESULT_SCHEMA).not.toHaveProperty("$schema");
  });
});

describe("readStageResult", () => {
  it("reads each status as the run's outcome, with the Handover note", () => {
    expect(
      readStageResult(
        {
          status: "done",
          summary: "Built.",
          handoverNote: "All set.",
          definitionOfDoneMet: [1, 3],
        },
        undefined,
        STATEMENTS,
      ),
    ).toEqual({
      valid: true,
      outcome: {
        status: "done",
        summary: "Built.",
        handoverNote: "All set.",
        definitionOfDoneMet: [1, 3],
      },
      screenshots: [],
    });
    expect(
      readStageResult(
        {
          status: "failed",
          summary: "Stopped.",
          failureReason: "The page is gone.",
          handoverNote: "Look at the router.",
        },
        undefined,
        STATEMENTS,
      ),
    ).toEqual({
      valid: true,
      outcome: {
        status: "failed",
        error: "The page is gone.",
        handoverNote: "Look at the router.",
      },
      screenshots: [],
    });
  });

  it("says what is wrong, for the Agent to correct", () => {
    expect(readStageResult({ status: "done", summary: "Built." }, undefined, STATEMENTS)).toEqual({
      valid: false,
      problems: 'status "done" requires "handoverNote".',
    });
    expect(
      readStageResult(
        { status: "done", summary: "Built.", handoverNote: "All set." },
        undefined,
        STATEMENTS,
      ),
    ).toEqual({ valid: false, problems: 'status "done" requires "definitionOfDoneMet".' });
    expect(readStageResult({ data: { status: "done" } }, undefined, STATEMENTS)).toMatchObject({
      valid: false,
    });
    expect(
      readStageResult({ status: "needs_decision", summary: "Asked." }, undefined, STATEMENTS),
    ).toEqual({
      valid: false,
      problems:
        'status "needs_decision" means you opened a Decision with open_decision or consult, and you opened none. Open it with one of them first, then end your turn with needs_decision again.',
    });
  });
});
