import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { DecisionService } from "../../application/decision-service.js";
import { ThreadRefused } from "../../domain/thread-refused.js";

export const OPEN_DECISION = "open_decision";

/**
 * The Office tool an Agent opens a Decision with, in a Thread on a Task (spec §2.4). It returns at
 * once: the Agent ends its turn, and the user's answer comes as its next message (spec §9).
 */
@Injectable()
export class DecisionOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly decisions: DecisionService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: OPEN_DECISION,
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
      run: async ({ question, context, options, recommended, why }, { sessionId }) => {
        try {
          await this.decisions.open(sessionId, {
            question,
            context,
            options,
            recommendation: { option: recommended - 1, reason: why },
          });
          return {
            text: "The Decision is open in this Thread, waiting on the user. End your turn now: their answer, or a follow-up question, comes as your next message.",
            isError: false,
          };
        } catch (error) {
          if (error instanceof ThreadRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    });
  }
}
