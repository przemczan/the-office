import { Injectable, type OnModuleInit } from "@nestjs/common";
import { CONSULT_TOOL, OPEN_DECISION_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import { DecisionService } from "../../application/decision-service.js";
import { APPROVAL_OPTIONS, consultDecision, type Consult } from "../../domain/consult.js";
import type { DecisionDraft } from "../../domain/decision.js";
import { ThreadRefused } from "../../domain/thread-refused.js";

const END_YOUR_TURN =
  "End your turn now: their answer, or a follow-up question, comes as your next message.";

/**
 * The Office tools an Agent asks with, in a Thread on a Task (spec §2.4, §6): it opens a Decision,
 * or consults a person, which in tier 1 opens a Decision for the user in their place. Each returns
 * at once: the Agent ends its turn, and the user's answer comes as its next message (spec §9).
 */
@Injectable()
export class DecisionOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly decisions: DecisionService,
  ) {}

  onModuleInit(): void {
    this.registerOpenDecision();
    this.registerConsult();
  }

  private registerOpenDecision(): void {
    this.registry.register({
      name: OPEN_DECISION_TOOL,
      description:
        "Opens a Decision in this Thread when a choice is the user's to make: they see your question as a card with its options and the one you recommend, and answer with an option or in their own words, or ask you a follow-up first. It returns at once; then end your turn without asking the question again. Their answer comes as your next message.",
      input: z.object({
        question: z.string().describe("One question, as the user reads it."),
        context: z
          .string()
          .describe("What the user needs to know to decide: what you found, in a few lines."),
        options: z
          .array(z.string())
          .describe("Two or more options, each a short line the user can choose."),
        recommended: z
          .number()
          .int()
          .describe("The option you recommend, by its number in the list, counting from 1."),
        why: z.string().describe("Why you recommend it, in a sentence."),
      }),
      run: ({ question, context, options, recommended, why }, { sessionId }) =>
        this.open(
          sessionId,
          { question, context, options, recommendation: { option: recommended - 1, reason: why } },
          `The Decision is open in this Thread, waiting on the user. ${END_YOUR_TURN}`,
        ),
    });
  }

  private registerConsult(): void {
    this.registry.register({
      name: CONSULT_TOOL,
      description: `Consults a person when your brief or your authority says to consult them first: with a question, or to ask approval of a call past a Hard switch, whose answer is ${APPROVAL_OPTIONS.join(" or ")}, never "always". The Office has no Consultations yet, so the user answers in their place, on a Decision card in this Thread. It returns at once; then end your turn without asking again. The answer comes as your next message.`,
      input: z.object({
        person: z
          .string()
          .describe(
            "Whom you consult, as your brief or your authority names them, such as Devops.",
          ),
        approval: z
          .boolean()
          .optional()
          .describe(
            `True to ask approval of a call past a Hard switch: the answer is ${APPROVAL_OPTIONS.join(" or ")}.`,
          ),
        question: z
          .string()
          .describe(
            "Your question; for an approval, the call you ask to make, such as: Install ffmpeg on the machine.",
          ),
        context: z.string().describe("What they need to know to answer: what you found."),
        options: z
          .array(z.string())
          .optional()
          .describe("For a question: two or more options, each a short line. None for approval."),
        recommended: z
          .number()
          .int()
          .optional()
          .describe("For a question: the option you recommend, by its number, counting from 1."),
        why: z
          .string()
          .describe(
            "For a question, why you recommend it; for an approval, why you need the call.",
          ),
      }),
      run: (input, { sessionId }) => {
        const consult: Consult = input.approval
          ? {
              kind: "approval",
              person: input.person,
              call: input.question,
              context: input.context,
              why: input.why,
            }
          : {
              kind: "question",
              person: input.person,
              question: input.question,
              context: input.context,
              options: input.options ?? [],
              recommended: (input.recommended ?? 0) - 1,
              why: input.why,
            };
        return this.open(
          sessionId,
          consultDecision(consult),
          `The Office put your consult to the user in place of ${input.person.trim()}, as a Decision in this Thread. ${END_YOUR_TURN}`,
        );
      },
    });
  }

  private async open(
    sessionId: string,
    draft: DecisionDraft,
    opened: string,
  ): Promise<OfficeToolResult> {
    try {
      await this.decisions.open(sessionId, draft);
      return { text: opened, isError: false };
    } catch (error) {
      if (error instanceof ThreadRefused) return { text: error.message, isError: true };
      throw error;
    }
  }
}
