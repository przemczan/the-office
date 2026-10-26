import { describe, expect, it } from "vitest";
import { readStageResult, STAGE_RESULT_SCHEMA } from "./stage-result.js";

/** A Decision the Agent opened with an Office tool. */
const asked = {
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
      ),
    ).toMatchObject({ valid: true, screenshots: ["dialog/open.png", "home.png"] });
  });

  it("needs the Decision the Agent opened with a tool, keeping the Handover note and no screenshots, whatever the status", () => {
    const outcome = { status: "needs-decision", ...asked, handoverNote: "Waiting." };

    expect(
      readStageResult(
        { status: "needs_decision", summary: "Asked.", handoverNote: "Waiting." },
        asked,
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
      ),
    ).toEqual({ valid: true, outcome, screenshots: [] });
    expect(readStageResult(undefined, asked)).toEqual({
      valid: true,
      outcome: { status: "needs-decision", ...asked },
      screenshots: [],
    });
  });

  it("says what is wrong, for the Agent to correct", () => {
    expect(readStageResult({ status: "done", summary: "Built." }, undefined)).toEqual({
      valid: false,
      problems: 'status "done" requires "handoverNote".',
    });
    expect(
      readStageResult({ status: "done", summary: "Built.", handoverNote: "All set." }, undefined),
    ).toEqual({ valid: false, problems: 'status "done" requires "definitionOfDoneMet".' });
    expect(readStageResult({ data: { status: "done" } }, undefined)).toMatchObject({
      valid: false,
    });
    expect(readStageResult({ status: "needs_decision", summary: "Asked." }, undefined)).toEqual({
      valid: false,
      problems:
        'status "needs_decision" means you opened a Decision with open_decision or consult, and you opened none. Open it with one of them first, then end your turn with needs_decision again.',
    });
  });
});
