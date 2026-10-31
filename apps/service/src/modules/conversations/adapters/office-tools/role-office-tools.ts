import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import { RoleNotFound, RoleRefused, RoleService } from "../../../people/index.js";
import { HeldCalls } from "../../application/held-calls.js";
import { CHANGE_ROLE_TOOL } from "../../domain/session-instructions.js";

type Words = { readonly responsibilities?: string; readonly instructions?: string };

/**
 * The Office tool that changes a Role (spec §6), which the Change Roles Hard switch holds: The
 * Office sees to it in code, so an Agent can't skip the approval its card asks for. The change
 * reaches the sessions started after it.
 */
@Injectable()
export class RoleOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly roles: RoleService,
    private readonly heldCalls: HeldCalls,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: CHANGE_ROLE_TOOL,
      description:
        'Rewords a Role\'s responsibilities or instructions; sessions started afterwards read the new words. Your Change Roles Hard switch decides whether it runs, is refused, or waits for approval. When it waits, end your turn: the answer comes as your next message, and after "Allow once" you repeat the same call, word for word, which then runs once.',
      input: z.object({
        role: z.string().describe("The Role's key, such as developer."),
        responsibilities: z
          .string()
          .optional()
          .describe("The new responsibilities, in a paragraph."),
        instructions: z.string().optional().describe("The new instructions."),
        why: z.string().describe("Why the Role should change, in a sentence."),
      }),
      run: async ({ role, responsibilities, instructions, why }, { sessionId }) => {
        const words: Words = {
          ...(responsibilities !== undefined && { responsibilities }),
          ...(instructions !== undefined && { instructions }),
        };
        try {
          return await this.change(sessionId, role.trim(), words, why);
        } catch (error) {
          if (error instanceof RoleNotFound) {
            return { text: `The Office has no Role "${role}".`, isError: true };
          }
          if (error instanceof RoleRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    });
  }

  private async change(
    sessionId: string,
    roleKey: string,
    words: Words,
    why: string,
  ): Promise<OfficeToolResult> {
    if (Object.keys(words).length === 0) {
      return {
        text: "Say what to change: the responsibilities or the instructions.",
        isError: true,
      };
    }
    // Looked up first, so nobody is asked to approve a change to a Role that isn't there.
    const { role } = await this.roles.read(roleKey);
    const outcome = await this.heldCalls.hold({
      sessionId,
      switchKey: "changeRoles",
      call: callIn(role.card.title, words),
      context: `${why}\n\nThe new words reach the sessions ${role.card.name} starts from now on.`,
      why,
    });
    if (outcome.kind === "refused") return { text: outcome.reason, isError: true };
    if (outcome.kind === "held") {
      return {
        text: `The call waits on ${outcome.waitingOn}, as a Decision in this Thread. End your turn now: their answer comes as your next message.`,
        isError: false,
      };
    }
    await this.roles.reword(roleKey, words, outcome.roleKey);
    return {
      text: `Changed: ${role.card.name}'s next sessions read the new words.`,
      isError: false,
    };
  }
}

/** The call as the user reads it on the approval, whole, so a repeat of it reads the same. */
function callIn(title: string, words: Words): string {
  const parts = [
    words.responsibilities !== undefined && `responsibilities to: ${words.responsibilities}`,
    words.instructions !== undefined && `instructions to: ${words.instructions}`,
  ].filter((part): part is string => part !== false);
  return `Change the ${title}'s ${parts.join("; and its ")}`;
}
