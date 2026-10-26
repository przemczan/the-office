import { z } from "zod";
import type { StageOutcome } from "./stage-run.js";

const recommendation = z.object({
  option: z
    .int()
    .min(0)
    .describe("The recommended option, by its place among the options, from 0."),
  reason: z.string().min(1).describe("Why you recommend it."),
});

const decision = z.object({
  question: z.string().min(1),
  context: z.string().describe("What the user needs to know to decide, as you found it."),
  options: z.array(z.string().min(1)).min(2),
  recommendation,
});

/**
 * An Agent Stage's result (research §6): flat, every field at the root beside `status`, since a
 * nested one made models wrap their whole answer in it. It is the same for every Stage and Task, so
 * it stays in the session's cached prefix.
 */
const stageResult = z.object({
  status: z.enum(["done", "needs_decision", "failed"]),
  summary: z.string().min(1).describe("One or two sentences: what you did, or why you stopped."),
  handoverNote: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Required when status is done: a few lines for whoever continues: where you are, what is left, what to watch. Welcome with the other statuses too.",
    ),
  definitionOfDoneMet: z
    .array(z.int().min(1))
    .optional()
    .describe(
      "Required when status is done: the numbers of the Definition of Done statements the work now meets, as the Brief numbers them; leave out any it doesn't meet yet.",
    ),
  decision: decision.optional().describe("Required when status is needs_decision."),
  failureReason: z.string().min(1).optional().describe("Required when status is failed."),
});

type StageResult = z.output<typeof stageResult>;

/** What each status requires beside the fields every result has. */
const REQUIRED_BY_STATUS: Readonly<Record<StageResult["status"], readonly (keyof StageResult)[]>> =
  {
    done: ["handoverNote", "definitionOfDoneMet"],
    needs_decision: ["decision"],
    failed: ["failureReason"],
  };

/**
 * The result schema an Agent Stage's session answers in. A root `if status = done then required`
 * clause lets the engine's own validation retry a missing Handover note within the turn, as proven
 * (research §6); combinators such as `allOf` stay out of a tool's root schema. What the other
 * statuses require is checked as the result is read, and corrected once.
 */
export const STAGE_RESULT_SCHEMA: Readonly<Record<string, unknown>> = (() => {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(stageResult, { io: "input" });
  return {
    ...schema,
    if: { properties: { status: { const: "done" } } },
    // oxlint-disable-next-line unicorn/no-thenable -- the JSON Schema keyword, never awaited
    then: { required: REQUIRED_BY_STATUS.done },
  };
})();

/** A session's result as an outcome, or what is wrong with it, in words the Agent can correct. */
export type StageResultReading =
  | { readonly valid: true; readonly outcome: StageOutcome }
  | { readonly valid: false; readonly problems: string };

export function readStageResult(output: unknown): StageResultReading {
  const parsed = stageResult.safeParse(output);
  if (!parsed.success) return { valid: false, problems: z.prettifyError(parsed.error) };
  const result = parsed.data;
  const missing = REQUIRED_BY_STATUS[result.status].find((field) => result[field] === undefined);
  if (missing) {
    return { valid: false, problems: `status "${result.status}" requires "${missing}".` };
  }
  return outcomeOf(result);
}

function outcomeOf({
  status,
  summary,
  handoverNote,
  definitionOfDoneMet,
  decision: asked,
  failureReason,
}: StageResult): StageResultReading {
  const note = handoverNote === undefined ? {} : { handoverNote };
  switch (status) {
    case "done":
      return {
        valid: true,
        outcome: {
          status: "done",
          summary,
          ...note,
          definitionOfDoneMet: definitionOfDoneMet ?? [],
        },
      };
    case "needs_decision": {
      if (!asked) throw new Error("A needs_decision result without its decision was read.");
      if (asked.options[asked.recommendation.option] === undefined) {
        return {
          valid: false,
          problems: "decision.recommendation.option is not one of the options.",
        };
      }
      return { valid: true, outcome: { status: "needs-decision", ...asked, ...note } };
    }
    case "failed":
      return {
        valid: true,
        outcome: { status: "failed", error: failureReason ?? summary, ...note },
      };
  }
}

/**
 * What The Office sends, once, when a session's result doesn't match the schema (research §6): the
 * same session corrects it, without redoing the work.
 */
export function correctionMessage(problems: string): string {
  return `Your result didn't match the Stage's result schema:\n\n${problems}\n\nDon't redo the work: answer again with the corrected result only.`;
}
