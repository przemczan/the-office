import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PROPOSE_ROLE_TOOL, roleCardSchema } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleNotFound, RoleService } from "../../../people/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import {
  proposedRoleChange,
  type ProposedChange,
  type RoleCardFields,
} from "../../domain/proposal.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";

const roleCardFieldsSchema = roleCardSchema.omit({ skills: true });

const DRAFTED =
  "The Proposal is in this chat as a card; nothing changes until the user applies it, and they may edit a new Role before hiring. Don't wait for it: tell the user what you propose and why, in a line or two.";

/**
 * The Office tool the Office Manager drafts a Role with (spec §2.2): a new Role or a change to one,
 * as a Proposal the user applies with a click. It changes nothing itself, so it sits behind no Hard
 * switch: the user's click is the approval. It returns at once.
 */
@Injectable()
export class ProposalOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly proposals: ProposalService,
    private readonly roles: RoleService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: PROPOSE_ROLE_TOOL,
      description:
        "Drafts a Role as a Proposal the user applies with a click: a new Role on its whole card, or a change to a hired Role's card. It shows in this chat as a card and changes nothing until the user applies it. It returns at once.",
      input: z.object({
        role: z
          .string()
          .optional()
          .describe(
            "The key of the Role to change, such as developer; leave it out for a new Role.",
          ),
        card: roleCardFieldsSchema
          .partial()
          .describe(
            "For a new Role, the whole Role card; for a change, only the fields that change, each one whole.",
          ),
        skills: z
          .array(z.string())
          .optional()
          .describe(
            "For a new Role, the library skills it has besides the skills for everyone, by name.",
          ),
      }),
      run: async ({ role, card, skills }, { sessionId }) => {
        try {
          const change =
            role === undefined
              ? newRole(card, skills)
              : await this.changeOf(role.trim(), card, skills);
          if (typeof change === "string") return { text: change, isError: true };
          await this.proposals.draft(sessionId, change);
          return { text: DRAFTED, isError: false };
        } catch (error) {
          if (error instanceof ProposalRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    });
  }

  private async changeOf(
    roleKey: string,
    fields: RoleCardFields,
    skills: readonly string[] | undefined,
  ): Promise<ProposedChange | string> {
    if (skills !== undefined) return "A change to a Role leaves its skills as they are.";
    try {
      const { role } = await this.roles.read(roleKey);
      return proposedRoleChange(roleKey, role.card, fields);
    } catch (error) {
      if (error instanceof RoleNotFound) return `The Office has no Role "${roleKey}".`;
      throw error;
    }
  }
}

/** A new Role on the card given, or what is missing from it, in words the Agent acts on. */
function newRole(
  fields: RoleCardFields,
  skills: readonly string[] | undefined,
): ProposedChange | string {
  const card = roleCardFieldsSchema.safeParse(fields);
  if (!card.success) {
    const named = [...new Set(card.error.issues.map((issue) => issue.path.join(".")))];
    return `A new Role needs its whole Role card; give ${named.join(", ")}.`;
  }
  return { kind: "hire", card: card.data, skills: skills ?? [], roleKey: undefined };
}
