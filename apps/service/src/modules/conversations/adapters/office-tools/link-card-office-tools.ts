import { Injectable, type OnModuleInit } from "@nestjs/common";
import { POST_LINK_CARD_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { LinkCards } from "../../application/link-cards.js";
import { ThreadRefused } from "../../domain/thread-refused.js";

const POSTED =
  "The Link card is in this chat. The user opens the Thread and sends the note themselves, edited or not; don't relay it or answer for them. Tell the user in a line why that person.";

/**
 * The Office tool the Office Manager points the user to whoever is responsible with (spec §2.2): a
 * Link card with a Handover note. It changes nothing and reaches nobody, so it sits behind no Hard
 * switch; it returns at once, with the reason when there is nobody to point to.
 */
@Injectable()
export class LinkCardOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly linkCards: LinkCards,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: POST_LINK_CARD_TOOL,
      description:
        "Points the user to whoever is responsible with a Link card in this chat: the person, with a Handover note the user may edit or leave out before sending it in a new Thread with them. You never relay a message or answer for someone else. It returns at once.",
      input: z.object({
        person: z
          .string()
          .optional()
          .describe(
            "The key of the person's Role, as list_people gives it; about a Task, leave it out for whoever works its latest Stage.",
          ),
        task: z
          .string()
          .optional()
          .describe("The id of the Task the user is pointed to someone about; the note links it."),
        note: z
          .string()
          .describe(
            "The Handover note: a line or two the user sends the person, in the user's voice.",
          ),
      }),
      run: async ({ person, task, note }, { sessionId }) => {
        try {
          await this.linkCards.post(sessionId, {
            to: given(person),
            taskId: given(task),
            note,
          });
          return { text: POSTED, isError: false };
        } catch (error) {
          if (error instanceof ThreadRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    });
  }
}

/** The value trimmed, or undefined when the Agent left it out or blank. */
function given(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}
