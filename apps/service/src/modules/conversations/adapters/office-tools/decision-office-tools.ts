import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ANSWER_CONSULTATION_TOOL, CONSULT_TOOL, OPEN_DECISION_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import { Consultations } from "../../application/consultations.js";
import { DecisionService } from "../../application/decision-service.js";
import { APPROVAL_OPTIONS, PASS_ON_STEPS, type Consult } from "../../domain/consult.js";
import type { DecisionDraft } from "../../domain/decision.js";
import { ThreadRefused } from "../../domain/thread-refused.js";

const END_YOUR_TURN =
  "End your turn now: their answer, or a follow-up question, comes as your next message.";

/**
 * The Office tools an Agent asks with, in a Thread on a Task (spec §2.4, §6): it opens a Decision,
 * or consults a person, whose Consultation answers a Decision put to them; a Consultant gives their
 * answer with the third. Asking returns at once: the Agent ends its turn, and the answer comes as
 * its next message (spec §9).
 */
@Injectable()
export class DecisionOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly decisions: DecisionService,
    private readonly consultations: Consultations,
  ) {}

  onModuleInit(): void {
    this.registerOpenDecision();
    this.registerConsult();
    this.registerAnswerConsultation();
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
      description: `Consults a person when your brief or your authority says to consult them first, or the user when your brief says to ask the user: with a question, or to ask approval of a call past a Hard switch, whose answer is ${APPROVAL_OPTIONS.join(" or ")}, never "always". A hired Consultant answers in a Consultation on the Task; if nobody who can be consulted fills that Role, the user answers in their place. Either way the question shows as a Decision card in this Thread. It returns at once; then end your turn without asking again. The answer comes as your next message.`,
      input: z.object({
        person: z
          .string()
          .optional()
          .describe(
            "Whom you consult, as your brief or your authority names them, such as Devops; none when your brief says to ask the user.",
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
      run: async (input, { sessionId }) => {
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
        try {
          const consultant = await this.consultations.put(sessionId, consult);
          const person = input.person?.trim();
          const putTo = consultant
            ? `${consultant.name}, in a Consultation on this Task`
            : person
              ? `the user in place of ${person}`
              : "the user";
          return {
            text: `The Office put your consult to ${putTo}, as a Decision in this Thread. ${END_YOUR_TURN}`,
            isError: false,
          };
        } catch (error) {
          if (error instanceof ThreadRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    });
  }

  private registerAnswerConsultation(): void {
    this.registry.register({
      name: ANSWER_CONSULTATION_TOOL,
      description: `Gives your answer in this Consultation: it answers the Decision the person who asked is waiting on, and reaches them as their next message. For a question, choose one of their options by its number, or answer in your own words. To approve a call, choose ${APPROVAL_OPTIONS.map((option, index) => `${index + 1} for "${option}"`).join(" or ")}, or pass it on when the call isn't yours to decide: to the person your authority names, or to the user. An approval goes up at most ${PASS_ON_STEPS} steps, then it is the user's. A question The Office put to you first, you answer in your own words, or pass on to the user.`,
      input: z.object({
        option: z
          .number()
          .int()
          .optional()
          .describe("The option you choose, by its number in their list, counting from 1."),
        answer: z
          .string()
          .optional()
          .describe("Your answer in your own words, when no option fits."),
        passOn: z
          .object({
            person: z
              .string()
              .optional()
              .describe("Whom you pass it on to, such as CTO; none to pass it on to the user."),
            why: z.string().describe("Why the call isn't yours to decide, in a sentence."),
          })
          .optional()
          .describe("To pass an approval, or The Office's question, on instead of answering it."),
      }),
      run: async ({ option, answer, passOn }, { sessionId }) => {
        try {
          if (passOn) {
            const next = await this.consultations.passOn(sessionId, passOn.person, passOn.why);
            const to = next ? `${next.name}, in a Consultation of their own` : "the user";
            return { text: `You passed it on to ${to}. End your turn.`, isError: false };
          }
          await this.consultations.answer(
            sessionId,
            option !== undefined
              ? { kind: "option", option: option - 1 }
              : { kind: "free-answer", text: answer ?? "" },
          );
          return { text: "Your answer reached them. End your turn.", isError: false };
        } catch (error) {
          if (error instanceof ThreadRefused) return { text: error.message, isError: true };
          throw error;
        }
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
