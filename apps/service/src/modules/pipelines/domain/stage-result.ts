import { z } from "zod";
import type { StageDecision, StageOutcome } from "./stage-run.js";

/**
 * An Agent Stage's result (research §6): flat, every field at the root beside `status`, since a
 * nested one made models wrap their whole answer in it. It is the same for every Stage and Task, so
 * it stays in the session's cached prefix.
 */
const stageResult = z.object({
  status: z
    .enum(["done", "needs_decision", "failed"])
    .describe(
      "done when the Stage's work is finished; needs_decision once you opened a Decision with open_decision or consult and wait for the answer; failed when you can't finish it.",
    ),
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
  failureReason: z.string().min(1).optional().describe("Required when status is failed."),
});

type StageResult = z.output<typeof stageResult>;

/** What each status requires beside the fields every result has. */
const REQUIRED_BY_STATUS: Readonly<Record<StageResult["status"], readonly (keyof StageResult)[]>> =
  {
    done: ["handoverNote", "definitionOfDoneMet"],
    needs_decision: [],
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

/**
 * Reads a turn's result, with the Decision its Agent opened with an Office tool since the Stage
 * began, if any (spec §9): the Stage then waits on that Decision whatever status the result gives,
 * as the tool told the Agent to end its turn, keeping the result's Handover note. Without one,
 * needs_decision asks nothing, so it is corrected like any other mismatch.
 */
export function readStageResult(
  output: unknown,
  asked: StageDecision | undefined,
): StageResultReading {
  if (asked) return { valid: true, outcome: askedOutcome(asked, output) };
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
    case "needs_decision":
      return { valid: false, problems: NO_DECISION_OPENED };
    case "failed":
      return {
        valid: true,
        outcome: { status: "failed", error: failureReason ?? summary, ...note },
      };
  }
}

const NO_DECISION_OPENED =
  'status "needs_decision" means you opened a Decision with open_decision or consult, and you opened none. Open it with one of them first, then end your turn with needs_decision again.';

function askedOutcome(asked: StageDecision, output: unknown): StageOutcome {
  const handoverNote = stageResult.safeParse(output).data?.handoverNote;
  return {
    status: "needs-decision",
    question: asked.question,
    context: asked.context,
    options: asked.options,
    recommendation: asked.recommendation,
    ...(handoverNote === undefined ? {} : { handoverNote }),
  };
}

/**
 * What The Office sends, once, when a session's result doesn't match the schema (research §6): the
 * same session corrects it, without redoing the work.
 */
export function correctionMessage(problems: string): string {
  return `Your result didn't match the Stage's result schema:\n\n${problems}\n\nDon't redo the work: answer again with the corrected result only.`;
}
