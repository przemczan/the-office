import { describe, expect, it } from "vitest";
import { readStageResult, STAGE_RESULT_SCHEMA } from "./stage-result.js";

const decision = {
  question: "Which page?",
  context: "Both list devices.",
  options: ["The device page", "The list"],
  recommendation: { option: 1, reason: "Users look there first." },
};

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
      "decision",
      "failureReason",
    ]);
    expect(STAGE_RESULT_SCHEMA).not.toHaveProperty("$schema");
  });
});

describe("readStageResult", () => {
  it("reads each status as the run's outcome, with the Handover note", () => {
    expect(
      readStageResult({
        status: "done",
        summary: "Built.",
        handoverNote: "All set.",
        definitionOfDoneMet: [1, 3],
      }),
    ).toEqual({
      valid: true,
      outcome: {
        status: "done",
        summary: "Built.",
        handoverNote: "All set.",
        definitionOfDoneMet: [1, 3],
      },
    });
    expect(readStageResult({ status: "needs_decision", summary: "Asked.", decision })).toEqual({
      valid: true,
      outcome: { status: "needs-decision", ...decision },
    });
    expect(
      readStageResult({
        status: "failed",
        summary: "Stopped.",
        failureReason: "The page is gone.",
        handoverNote: "Look at the router.",
      }),
    ).toEqual({
      valid: true,
      outcome: {
        status: "failed",
        error: "The page is gone.",
        handoverNote: "Look at the router.",
      },
    });
  });

  it("says what is wrong, for the Agent to correct", () => {
    expect(readStageResult({ status: "done", summary: "Built." })).toEqual({
      valid: false,
      problems: 'status "done" requires "handoverNote".',
    });
    expect(
      readStageResult({ status: "done", summary: "Built.", handoverNote: "All set." }),
    ).toEqual({ valid: false, problems: 'status "done" requires "definitionOfDoneMet".' });
    expect(readStageResult({ data: { status: "done" } })).toMatchObject({ valid: false });
    expect(
      readStageResult({
        status: "needs_decision",
        summary: "Asked.",
        decision: { ...decision, recommendation: { option: 2, reason: "None." } },
      }),
    ).toEqual({
      valid: false,
      problems: "decision.recommendation.option is not one of the options.",
    });
  });
});
