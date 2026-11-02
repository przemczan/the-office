import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  OFFICE_WIDE_LIMIT_MAX,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_ROLE_TOOL,
  roleCardSchema,
  SIZE_THRESHOLD_TOKENS,
} from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleNotFound, RoleService } from "../../../people/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import {
  OFFICE_SETTINGS,
  proposedRoleChange,
  type ProposedChange,
  type RoleCardFields,
} from "../../domain/proposal.js";
import { refusedToTheAgent } from "./refused-to-the-agent.js";

// A Role override is the user's to set on the card: a proposed Role runs on the Office default.
const roleCardFieldsSchema = roleCardSchema.omit({ skills: true, roleOverride: true }).extend({
  name: z
    .string()
    .describe(
      "The person's first name, apart from the Role's title: a person is never named by it.",
    ),
});

const ROLE_DRAFTED =
  "The Proposal is in this chat as a card; nothing changes until the user applies it, and they may edit a new Role before hiring. Don't wait for it: tell the user what you propose and why, in a line or two.";

const SETTING_DRAFTED =
  "The Proposal is in this chat as a card; nothing changes until the user applies it. Don't wait for it: tell the user what you propose and why, in a line or two.";

/**
 * The Office tools the Office Manager drafts Proposals with (spec §2.2): a Role (a new one, from
 * scratch or from a preset, or a change to one) and an Office setting, each a Proposal the user
 * applies with a click. They change nothing themselves, so they sit behind no Hard switch: the
 * user's click is the approval. They return at once, with the owner's reasons when it would refuse.
 */
@Injectable()
export class ProposalOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly proposals: ProposalService,
    private readonly roles: RoleService,
  ) {}

  onModuleInit(): void {
    this.registerProposeRole();
    this.registerProposeOfficeSetting();
  }

  private registerProposeRole(): void {
    const presets = this.roles.presets().map(({ roleKey }) => roleKey);
    this.registry.register({
      name: PROPOSE_ROLE_TOOL,
      description:
        "Drafts a Role as a Proposal the user applies with a click: a new Role on its whole card, a person hired into a preset's Role, or a change to a hired Role's card. It shows in this chat as a card and changes nothing until the user applies it. It returns at once.",
      input: z.object({
        role: z
          .string()
          .optional()
          .describe(
            "The key of the Role to change, such as developer; leave it out for a new Role.",
          ),
        preset: z
          .string()
          .optional()
          .describe(
            `The key of the preset whose Role to hire into, on the preset's card: ${presets.join(", ")}. A preset's Role is hired only from its preset; give the person's name as card.name and nothing else.`,
          ),
        card: roleCardFieldsSchema
          .partial()
          .describe(
            "For a new Role, the whole Role card; for a preset's Role, only the name; for a change, only the fields that change, each one whole.",
          ),
        skills: z
          .array(z.string())
          .optional()
          .describe(
            "For a new Role, the library skills it has besides the skills for everyone, by name.",
          ),
      }),
      run: async ({ role, preset, card, skills }, { sessionId }) => {
        const change =
          preset !== undefined
            ? this.presetRole(preset.trim(), role, card, skills)
            : role === undefined
              ? newRole(card, skills)
              : await this.changeOf(role.trim(), card, skills);
        if (typeof change === "string") return { text: change, isError: true };
        return refusedToTheAgent(async () => {
          await this.proposals.draft(sessionId, change);
          return ROLE_DRAFTED;
        });
      },
    });
  }

  private registerProposeOfficeSetting(): void {
    this.registry.register({
      name: PROPOSE_OFFICE_SETTING_TOOL,
      description:
        "Drafts a new value for an Office setting as a Proposal the user applies with a click. It shows in this chat as a card, with the value now and the one proposed, and changes nothing until the user applies it. It returns at once.",
      input: z.object({
        setting: z
          .enum(OFFICE_SETTINGS)
          .describe(
            `office-wide-limit: how many Tasks may run at once across The Office, from 1 to ${OFFICE_WIDE_LIMIT_MAX}. size-threshold: once a Thread's cache has cooled, how many tokens the conversation may have added since its session began before its next message starts a fresh session with a Brief, from ${SIZE_THRESHOLD_TOKENS.min} to ${SIZE_THRESHOLD_TOKENS.max} in steps of ${SIZE_THRESHOLD_TOKENS.step}.`,
          ),
        value: z.number().describe("The new value."),
      }),
      run: ({ setting, value }, { sessionId }) =>
        refusedToTheAgent(async () => {
          await this.proposals.draftSetting(sessionId, setting, value);
          return SETTING_DRAFTED;
        }),
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
      const { name, title } = { ...role.card, ...fields };
      const renamed = fields.name !== undefined || fields.title !== undefined;
      return (
        (renamed ? nameProblem(name, title) : undefined) ??
        proposedRoleChange(roleKey, role.card, fields)
      );
    } catch (error) {
      if (error instanceof RoleNotFound) return `The Office has no Role "${roleKey}".`;
      throw error;
    }
  }

  /** A person in the preset's Role, or what is wrong with the call, in words the Agent acts on. */
  private presetRole(
    roleKey: string,
    role: string | undefined,
    { name = "", ...fields }: RoleCardFields,
    skills: readonly string[] | undefined,
  ): ProposedChange | string {
    if (role !== undefined) return "Give a preset to hire from or a Role to change, not both.";
    if (skills !== undefined || Object.keys(fields).length > 0) {
      return "A preset's Role is hired on the preset's card; give only the person's name as card.name. Their card can change once they are hired.";
    }
    // An unknown preset is refused as the Proposal is drafted, by the owner.
    const preset = this.roles.presets().find((candidate) => candidate.roleKey === roleKey);
    return (
      (preset && nameProblem(name, preset.card.title)) ?? {
        kind: "hire-from-preset",
        roleKey,
        name,
      }
    );
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
  return (
    nameProblem(card.data.name, card.data.title) ?? {
      kind: "hire",
      card: { ...card.data, roleOverride: null },
      skills: skills ?? [],
      roleKey: undefined,
    }
  );
}

/** Why a person can't be named `name` in a Role titled `title`: never by the title itself. */
function nameProblem(name: string, title: string): string | undefined {
  if (name.trim().toLowerCase() !== title.trim().toLowerCase()) return undefined;
  return `"${name.trim()}" is the Role's title; give the person a first name of their own as card.name.`;
}
