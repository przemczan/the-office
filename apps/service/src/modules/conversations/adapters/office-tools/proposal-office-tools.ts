import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  OFFICE_INSTRUCTIONS_MAX_CHARACTERS,
  OFFICE_WIDE_LIMIT_MAX,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_OFFICE_SETUP_TOOL,
  roleCardSchema,
  SIZE_THRESHOLD_TOKENS,
} from "@the-office/contracts";
import { z } from "zod";
import { CORE_AREA, OfficeToolRegistry } from "../../../engine/index.js";
import {
  DUTIES,
  Duties,
  dutiesSuitedTo,
  hiredKeyOf,
  RoleService,
  type DutyKey,
  type SetUpDuty,
  type SetUpHire,
  cardWithAuthority,
} from "../../../people/index.js";
import { OfficeInstructions } from "../../application/office-instructions.js";
import { ProposalService } from "../../application/proposal-service.js";
import {
  OFFICE_SETTINGS,
  type DutyHolders,
  type OfficeSetting,
  type ProposedChange,
  type ProposedHire,
  type ProposedPresetHire,
  type IncomingCardFields,
  type ProposedSettingValue,
} from "../../domain/proposal.js";
import { READ_OFFICE_INSTRUCTIONS_TOOL } from "../../domain/session-instructions.js";
import { refusedToTheAgent } from "./refused-to-the-agent.js";

const roleCardFieldsSchema = roleCardSchema.omit({ skills: true }).extend({
  name: z
    .string()
    .describe(
      "The person's first name, apart from the Role's title: a person is never named by it.",
    ),
  hardSwitches: roleCardSchema.shape.hardSwitches
    .optional()
    .describe(
      "The four named groups of authority as an earlier release gave them: runInstalls, publishOutsideThePipeline, changeRoles and changeProjectSettings. Ignored when authority is given; give authority instead.",
    ),
  authority: roleCardSchema.shape.authority.describe(
    "The rows of the card's Authority to set, by group, each Allowed, Consult a person (by the Role's key), Ask me, Proposal or Never; a record row may take an own and an others' value. A row left out stays at the preset's default; for a change, give the whole Authority the card will set.",
  ),
  engineSettings: roleCardSchema.shape.engineSettings
    .optional()
    .describe(
      "The model and effort the person works with on each engine type, by the type (claude-code, codex, copilot-cli, gemini-cli, openai-compatible-api): { model, effort }, null for the engine's default. Leave a type out to keep the engine's default; a new Role left without it works with each engine's defaults.",
    ),
});

const SETUP_DRAFTED =
  "The Proposal is in this Thread as a card; nobody is hired and no duty changes until the user applies it, all together. Don't wait for it: tell the user whom you propose to hire, for which duties, and why, in a few lines.";

const SETTING_DRAFTED =
  "The Proposal is in this Thread as a card; nothing changes until the user applies it. Don't wait for it: tell the user what you propose and why, in a line or two.";

/**
 * The Office tools the Default person to talk to drafts Proposals with (spec §2.2): an Office
 * setting, a Proposal the user applies with a click, and the read of the Office instructions a draft of them starts
 * from; and the Caretaker's set-up of The Office, its hires and duties in one Proposal. They
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
    private readonly duties: Duties,
  ) {}

  onModuleInit(): void {
    this.registerProposeOfficeSetting();
    this.registerProposeOfficeSetup();
    this.registerReadOfficeInstructions();
  }

  private registerProposeOfficeSetting(): void {
    this.registry.register({
      name: PROPOSE_OFFICE_SETTING_TOOL,
      area: "officeSettings",
      description:
        "Drafts a new value for an Office setting as a Proposal the user applies with a click. It shows in this Thread as a card and changes nothing until the user applies it. It returns at once.",
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

  private registerProposeOfficeSetup(): void {
    const presets = this.roles
      .presets()
      .map((preset) => {
        const duties = dutiesSuitedTo(preset);
        const suits = duties.length === 0 ? "no duty" : duties.join(", ");
        return `${preset.roleKey} (${preset.card.title}; ${suits})`;
      })
      .join(", ");
    this.registry.register({
      name: PROPOSE_OFFICE_SETUP_TOOL,
      area: "officeSettings",
      description: `Drafts the set-up of The Office as one Proposal the user applies with a click: the people to hire, each from a preset or from scratch, and the duties to give to a Role other than the one holding them by default. Applying hires everyone and assigns the duties together, or nothing. A hired preset holds its own duties with no assignment. The presets, with the duties each holds by default: ${presets}. The duties: ${DUTY_LIST}. It shows in this Thread as a card and changes nothing until the user applies it. It returns at once.`,
      input: z.object({
        hires: z
          .array(
            z.object({
              preset: z
                .string()
                .optional()
                .describe(
                  "The key of the preset to hire into, on the preset's card; give the person's name as name and no card. Leave it out for a Role from scratch.",
                ),
              name: z
                .string()
                .optional()
                .describe(
                  "For a preset, the person's first name, apart from the Role's title: a person is never named by it.",
                ),
              card: roleCardFieldsSchema
                .partial()
                .optional()
                .describe(
                  "For a Role from scratch, its whole Role card; its key comes from its title, such as data-analyst for Data Analyst.",
                ),
              skills: z
                .array(z.string())
                .optional()
                .describe(
                  "For a Role from scratch, the library skills it has besides the skills for everyone, by name.",
                ),
            }),
          )
          .describe("The people to hire; empty when only duties change."),
        duties: z
          .array(
            z.object({
              duty: z.string().describe("The duty's key."),
              holder: z
                .string()
                .describe(
                  "The key of the Role to hold it: one hired now or one of hires, a preset's key or the key a new Role's title makes.",
                ),
            }),
          )
          .describe(
            "The duties to give to a Role other than their default, each named once; empty when every duty stays with its default.",
          ),
      }),
      run: async ({ hires, duties }, { sessionId }) => {
        const setUp = await this.setUpOf(hires, duties);
        if (typeof setUp === "string") return { text: setUp, isError: true };
        return refusedToTheAgent(async () => {
          await this.proposals.draft(sessionId, setUp);
          return SETUP_DRAFTED;
        });
      },
    });
  }

  /** The set-up the call gives, each duty from the Role it names now, or what is wrong with it. */
  private async setUpOf(
    hires: readonly HireInput[],
    duties: readonly SetUpDutyInput[],
  ): Promise<ProposedChange | string> {
    const setUpHires: SetUpHire[] = [];
    for (const hire of hires) {
      const setUpHire = this.setUpHireOf(hire);
      if (typeof setUpHire === "string") return setUpHire;
      setUpHires.push(setUpHire);
    }
    const namedNow = new Map(
      (await this.duties.list()).map(({ duty, roleKey }) => [duty, roleKey]),
    );
    const setUpDuties: SetUpDuty[] = [];
    for (const { duty, holder } of duties) {
      const key = duty.trim();
      if (!isDutyKey(key)) return `The Office has no duty "${key}"; the duties are ${DUTY_LIST}.`;
      setUpDuties.push({ duty: key, from: namedNow.get(key) ?? null, to: holder.trim() });
    }
    return { kind: "office-setup", hires: setUpHires, duties: setUpDuties, hiredKeys: undefined };
  }

  /** One hire of a set-up, or what is wrong with it, in words the Agent acts on. */
  private setUpHireOf({ preset, name, card, skills }: HireInput): SetUpHire | string {
    if (preset !== undefined) {
      if (card !== undefined || skills !== undefined) {
        return `A preset's Role is hired on the preset's card; give only the person's name for ${preset}. Their card can change once they are hired.`;
      }
      const role = this.presetRole(preset.trim(), undefined, { name: name ?? "" }, undefined);
      return typeof role === "string"
        ? role
        : { kind: role.kind, roleKey: role.roleKey, name: role.name };
    }
    if (name !== undefined) return "For a Role from scratch, give the person's name as card.name.";
    const role = newRole(card ?? {}, skills);
    return typeof role === "string"
      ? role
      : { kind: role.kind, card: role.card, skills: role.skills };
  }

  private registerReadOfficeInstructions(): void {
    this.registry.register({
      name: READ_OFFICE_INSTRUCTIONS_TOOL,
      area: CORE_AREA,
      description: `Reads the Office instructions as they are now, which may be newer than the ones in your session. Read them before drafting a change with ${PROPOSE_OFFICE_SETTING_TOOL}.`,
      input: z.object({}),
      run: async () => {
        const { text } = await this.officeInstructions.current();
        return { text: text === "" ? "The Office instructions are empty." : text, isError: false };
      },
    });
  }

  /** A person in the preset's Role, or what is wrong with the call, in words the Agent acts on. */
  private presetRole(
    roleKey: string,
    role: string | undefined,
    { name = "", ...fields }: IncomingCardFields,
    skills: readonly string[] | undefined,
  ): ProposedPresetHire | string {
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

/** One hire of a set-up, as the call gives it. */
interface HireInput {
  readonly preset?: string | undefined;
  readonly name?: string | undefined;
  readonly card?: IncomingCardFields | undefined;
  readonly skills?: readonly string[] | undefined;
}

/** A duty of a set-up and the Role to hold it, as the call gives it. */
interface SetUpDutyInput {
  readonly duty: string;
  readonly holder: string;
}

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
  fields: IncomingCardFields,
  skills: readonly string[] | undefined,
): ProposedHire | string {
  const card = roleCardFieldsSchema.safeParse(fields);
  if (!card.success) {
    const named = [...new Set(card.error.issues.map((issue) => issue.path.join(".")))];
    return `A new Role needs its whole Role card; give ${named.join(", ")}.`;
  }
  const given = { ...card.data, engineSettings: card.data.engineSettings ?? {} };
  // Its key comes from its title, as hiring makes it.
  const roleKey = hiredKeyOf({ kind: "hire", card: { ...given, authority: {} }, skills: [] });
  return (
    nameProblem(card.data.name, card.data.title) ?? {
      kind: "hire",
      card: cardWithAuthority(roleKey, given, {}),
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
