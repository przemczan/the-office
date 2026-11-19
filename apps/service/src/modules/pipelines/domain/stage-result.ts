import { z } from "zod";
import { promptTemplate, type PromptTexts } from "../../prompt-templates/index.js";
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
      "Required when status is done: the numbers of the Definition of Done statements your work meets, as the Brief numbers them; leave out any it doesn't meet yet. One an earlier Stage reported met stays met unless you list it in definitionOfDoneNoLongerMet.",
    ),
  definitionOfDoneNoLongerMet: z
    .array(z.int().min(1))
    .optional()
    .describe(
      "With status done: the numbers of the Definition of Done statements an earlier Stage reported met that the work no longer meets, such as a regression found in review.",
    ),
  definitionOfDoneOutOfReach: z
    .array(
      z.object({
        statement: z.int().min(1).describe("The statement's number, as the Brief numbers it."),
        why: z.string().min(1).describe("Why you can't verify it where you work."),
      }),
    )
    .optional()
    .describe(
      "With status done: the Definition of Done statements you can't verify where you work, however many rounds you get, such as a live check on the user's workstation, each with why. Never count them as met; one that just isn't finished yet doesn't go here.",
    ),
  failureReason: z.string().min(1).optional().describe("Required when status is failed."),
  screenshots: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "The screenshots you took in this Stage for the user to look at, by their paths inside the screenshots folder the Brief names. The Office attaches exactly these; leave out any you didn't take for this Task.",
    ),
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

/**
 * A session's result as an outcome with the screenshots it lists, or what is wrong with it, in
 * words the Agent can correct.
 */
export type StageResultReading =
  | {
      readonly valid: true;
      readonly outcome: StageOutcome;
      /** Relative to the screenshots folder; none when it lists none. */
      readonly screenshots: readonly string[];
    }
  | { readonly valid: false; readonly problems: string };

/**
 * Reads a turn's result, with the Decision its Agent opened with an Office tool since the Stage
 * began, if any (spec §9): the Stage then waits on that Decision whatever status the result gives,
 * as the tool told the Agent to end its turn, keeping the result's Handover note and none of its
 * screenshots. Without one,
 * needs_decision asks nothing, so it is corrected like any other mismatch. `statementCount` is how
 * many statements the Task's Definition of Done has, which the out of reach ones are checked against.
 */
export function readStageResult(
  output: unknown,
  asked: StageDecision | undefined,
  statementCount: number,
): StageResultReading {
  // The Stage runs again once the Decision is answered, and lists its screenshots as it ends then.
  if (asked) return { valid: true, outcome: askedOutcome(asked, output), screenshots: [] };
  const parsed = stageResult.safeParse(output);
  if (!parsed.success) return { valid: false, problems: z.prettifyError(parsed.error) };
  const result = parsed.data;
  const missing = REQUIRED_BY_STATUS[result.status].find((field) => result[field] === undefined);
  if (missing) {
    return { valid: false, problems: `status "${result.status}" requires "${missing}".` };
  }
  const statementProblem =
    outOfReachProblemOf(result, statementCount) ?? noLongerMetProblemOf(result, statementCount);
  if (statementProblem) return { valid: false, problems: statementProblem };
  const outcome = outcomeOf(result);
  if (!outcome) return { valid: false, problems: NO_DECISION_OPENED };
  return { valid: true, outcome, screenshots: result.screenshots ?? [] };
}

/** A statement out of reach the Definition of Done doesn't have, or that is also reported met. */
function outOfReachProblemOf(
  { definitionOfDoneMet, definitionOfDoneOutOfReach }: StageResult,
  statementCount: number,
): string | undefined {
  const outOfReach = (definitionOfDoneOutOfReach ?? []).map(({ statement }) => statement);
  const unknown = outOfReach.filter((statement) => statement > statementCount);
  if (unknown.length > 0) {
    return `"definitionOfDoneOutOfReach" names ${numbersWords(unknown)}, which the Definition of Done doesn't have: it has ${statementCount}.`;
  }
  const met = new Set(definitionOfDoneMet);
  const both = outOfReach.filter((statement) => met.has(statement));
  if (both.length > 0) {
    return `"definitionOfDoneMet" and "definitionOfDoneOutOfReach" both name ${numbersWords(both)}: a statement you can't verify isn't met, so list it only as out of reach.`;
  }
  return undefined;
}

/** A statement no longer met the Definition of Done doesn't have, or that is also reported met. */
function noLongerMetProblemOf(
  { definitionOfDoneMet, definitionOfDoneNoLongerMet }: StageResult,
  statementCount: number,
): string | undefined {
  const noLongerMet = definitionOfDoneNoLongerMet ?? [];
  const unknown = noLongerMet.filter((statement) => statement > statementCount);
  if (unknown.length > 0) {
    return `"definitionOfDoneNoLongerMet" names ${numbersWords(unknown)}, which the Definition of Done doesn't have: it has ${statementCount}.`;
  }
  const met = new Set(definitionOfDoneMet);
  const both = noLongerMet.filter((statement) => met.has(statement));
  if (both.length > 0) {
    return `"definitionOfDoneMet" and "definitionOfDoneNoLongerMet" both name ${numbersWords(both)}: list a statement as met or as no longer met, not both.`;
  }
  return undefined;
}

function numbersWords(statements: readonly number[]): string {
  return statements.length === 1
    ? `statement ${statements.join("")}`
    : `statements ${statements.join(", ")}`;
}

/** Undefined for needs_decision, which asks nothing without a Decision opened. */
function outcomeOf({
  status,
  summary,
  handoverNote,
  definitionOfDoneMet,
  definitionOfDoneNoLongerMet,
  definitionOfDoneOutOfReach,
  failureReason,
}: StageResult): StageOutcome | undefined {
  const note = handoverNote === undefined ? {} : { handoverNote };
  switch (status) {
    case "done":
      return {
        status: "done",
        summary,
        ...note,
        definitionOfDoneMet: definitionOfDoneMet ?? [],
        ...(definitionOfDoneNoLongerMet !== undefined &&
          definitionOfDoneNoLongerMet.length > 0 && { definitionOfDoneNoLongerMet }),
        ...(definitionOfDoneOutOfReach !== undefined &&
          definitionOfDoneOutOfReach.length > 0 && { definitionOfDoneOutOfReach }),
      };
    case "needs_decision":
      return undefined;
    case "failed":
      return { status: "failed", error: failureReason ?? summary, ...note };
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

/** Why the screenshots a result lists weren't attached, as a problem the Agent corrects. */
export function screenshotsRefused(problems: readonly string[]): string {
  const lines = problems.map((problem) => `- ${problem}`).join("\n");
  return `None of the screenshots you listed was attached, as The Office attaches all or none:\n${lines}\nList only images you wrote in the screenshots folder, each at most 2 MiB.`;
}

/**
 * What The Office sends, once, when a session's result doesn't match the schema (research §6): the
 * same session corrects it, without redoing the work.
 */
export function correctionMessage(prompts: PromptTexts, problems: string): string {
  return prompts.render(RESULT_CORRECTION, { problems });
}

/** The request to correct a result that didn't match the schema, with what is wrong with it. */
export const RESULT_CORRECTION = promptTemplate({
  key: "pipelines.result-correction",
  domain: "pipelines",
  name: "Correction of a Stage's result",
  description:
    "What an Agent is told, once, when its Stage's result doesn't match the result schema.",
  variables: {
    problems: {
      kind: "text",
      description: "What is wrong with the result, as the schema check words it.",
    },
  },
  text: `Your result didn't match the Stage's result schema:

{{problems}}

Don't redo the work: answer again with the corrected result only.`,
});
