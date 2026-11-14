import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  OFFICE_INSTRUCTIONS_MAX_CHARACTERS,
  OFFICE_WIDE_LIMIT_MAX,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_ROLE_TOOL,
  roleCardSchema,
  SIZE_THRESHOLD_TOKENS,
} from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { DUTIES, RoleNotFound, RoleService, type DutyKey } from "../../../people/index.js";
import { OfficeInstructions } from "../../application/office-instructions.js";
import { ProposalService } from "../../application/proposal-service.js";
import {
  OFFICE_SETTINGS,
  proposedRoleChange,
  type DutyHolders,
  type OfficeSetting,
  type ProposedChange,
  type ProposedSettingValue,
  type RoleCardFields,
} from "../../domain/proposal.js";
import {
  READ_OFFICE_INSTRUCTIONS_TOOL,
  READ_ROLE_TOOL,
} from "../../domain/session-instructions.js";
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
 * applies with a click, and the read of the Office instructions a draft of them starts from. They
 * change nothing themselves, so they sit behind no Hard switch: the user's click is the approval.
 * They return at once, with the owner's reasons when it would refuse.
 */
@Injectable()
export class ProposalOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly proposals: ProposalService,
    private readonly roles: RoleService,
    private readonly officeInstructions: OfficeInstructions,
  ) {}

  onModuleInit(): void {
    this.registerProposeRole();
    this.registerProposeOfficeSetting();
    this.registerReadOfficeInstructions();
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
            `The key of the Role to change, such as developer; leave it out for a new Role. Read its whole card with ${READ_ROLE_TOOL} first and start the change from what it answers, since your session's copy may be old.`,
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
            `For a new Role, the whole Role card; for a preset's Role, only the name; for a change, only the fields that change, each one whole, written from what ${READ_ROLE_TOOL} answers: new instructions replace all of them, not only the lines that change.`,
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
        "Drafts a new value for an Office setting as a Proposal the user applies with a click. It shows in this chat as a card and changes nothing until the user applies it. It returns at once.",
      input: z.object({
        setting: z
          .enum(OFFICE_SETTINGS)
          .describe(
            `office-wide-limit: how many Tasks may run at once across The Office, from 1 to ${OFFICE_WIDE_LIMIT_MAX}. size-threshold: once a Thread's cache has cooled, how many tokens the conversation may have added since its session began before its next message starts a fresh session with a Brief, from ${SIZE_THRESHOLD_TOKENS.min} to ${SIZE_THRESHOLD_TOKENS.max} in steps of ${SIZE_THRESHOLD_TOKENS.step}. office-instructions: the one text of general guidelines every person's session gets with their Role's instructions, from the next session on, at most ${OFFICE_INSTRUCTIONS_MAX_CHARACTERS} characters. duties: who holds each duty, the built-in jobs The Office gives to a hired Role: ${DUTY_LIST}.`,
          ),
        value: z
          .number()
          .optional()
          .describe("The new value of office-wide-limit or size-threshold."),
        text: z
          .string()
          .optional()
          .describe(
            `The new text of office-instructions, given whole: it replaces all of them, not only the lines that change. Start from what ${READ_OFFICE_INSTRUCTIONS_TOOL} answers, since your session's copy may be old.`,
          ),
        duties: z
          .array(
            z.object({
              duty: z.string().describe("The duty's key."),
              holder: z
                .string()
                .nullable()
                .describe("The key of the hired Role to hold it, or null for nobody."),
            }),
          )
          .optional()
          .describe(
            "The duties whose holder changes, each named once, for duties: applied all together or not at all.",
          ),
      }),
      run: ({ setting, value, text, duties }, { sessionId }) => {
        const proposed = proposedSettingValue(setting, value, text, duties);
        if (typeof proposed === "string") return Promise.resolve({ text: proposed, isError: true });
        return refusedToTheAgent(async () => {
          await this.proposals.draftSetting(sessionId, proposed);
          return SETTING_DRAFTED;
        });
      },
    });
  }

  private registerReadOfficeInstructions(): void {
    this.registry.register({
      name: READ_OFFICE_INSTRUCTIONS_TOOL,
      description: `Reads the Office instructions as they are now, which may be newer than the ones in your session. Read them before drafting a change with ${PROPOSE_OFFICE_SETTING_TOOL}.`,
      input: z.object({}),
      run: async () => {
        const { text } = await this.officeInstructions.current();
        return { text: text === "" ? "The Office instructions are empty." : text, isError: false };
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

const DUTY_LIST = DUTIES.map(({ key, label }) => `${key} (${label})`).join(", ");

/** A duty's new holder, as the call gives it. */
interface DutyHolderInput {
  readonly duty: string;
  readonly holder: string | null;
}

/** The value the call gives the setting, or what is wrong with it, in words the Agent acts on. */
function proposedSettingValue(
  setting: OfficeSetting,
  value: number | undefined,
  text: string | undefined,
  duties: readonly DutyHolderInput[] | undefined,
): ProposedSettingValue | string {
  if (setting === "duties") {
    if (duties === undefined || duties.length === 0 || value !== undefined || text !== undefined) {
      return "Give the duties that change as duties, each with its new holder, and no value or text.";
    }
    return proposedHolders(duties);
  }
  if (duties !== undefined) return `Give duties only for the setting duties, not ${setting}.`;
  if (setting === "office-instructions") {
    if (text === undefined || value !== undefined) {
      return "Give the whole new Office instructions as text, and no value.";
    }
    return { setting, value: text.trim() };
  }
  if (value === undefined || text !== undefined) {
    return `Give the new ${setting} as value, and no text.`;
  }
  return { setting, value };
}

/** The duties' new holders, or what is wrong with them, in words the Agent acts on. */
function proposedHolders(duties: readonly DutyHolderInput[]): ProposedSettingValue | string {
  const holders: Partial<Record<DutyKey, string | null>> = {};
  for (const { duty, holder } of duties) {
    const key = duty.trim();
    if (!isDutyKey(key)) return `The Office has no duty "${key}"; the duties are ${DUTY_LIST}.`;
    if (Object.hasOwn(holders, key)) return `Name each duty once; ${key} is named twice.`;
    holders[key] = holder === null ? null : holder.trim();
  }
  return { setting: "duties", value: holders satisfies DutyHolders };
}

function isDutyKey(key: string): key is DutyKey {
  return DUTIES.some((duty) => duty.key === key);
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
