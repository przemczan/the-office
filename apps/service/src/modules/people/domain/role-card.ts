import { ENGINE_TYPE_NAMES, type EngineKind } from "../../engine/index.js";
import { builtInCardProblems } from "./caretaker.js";
import {
  authorityProblems,
  authorityWithHardSwitches,
  keptAuthority,
  type Authority,
} from "./authority.js";
import type { HardSwitches } from "./hard-switches.js";
import { mcpToolSettingsProblems } from "./mcp-tool-settings.js";
import type { PermissionProfile } from "./permission-profile.js";
import { taskLimitProblem, type TaskLimit } from "./task-limit.js";

/** How hard the model thinks. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * The Role's default for continuing a Thread: the Context policy's choice, or always one way
 * (spec §2.5). A Stage's declared session still wins at a Stage boundary.
 */
export const SESSION_DEFAULTS = [
  "context-policy",
  "always-start-fresh",
  "prefer-to-continue",
] as const;
export type SessionDefault = (typeof SESSION_DEFAULTS)[number];

/** Each switched freely (spec §2.2). */
export interface Capabilities {
  /** Off until tier 2, which gives it a form. */
  readonly sharedMemory: boolean;
  /** The user can open a chat with the person at any time. */
  readonly chat: boolean;
  /** Other Agents may consult the person on a Task. */
  readonly consultant: boolean;
  /**
   * In an Agent Stage, the person writes the Project's run environment definition through The
   * Office's tool, which checks it first; Write and Edit can't reach `.devcontainer/` (spec §6).
   */
  readonly runEnvironment: boolean;
}

/**
 * Everything a session of the Role's person needs. Its Skills are assigned by the Skills module,
 * keyed by the Role.
 */
export interface RoleCard {
  /** The person's name, as in "Ada · Developer". */
  readonly name: string;
  readonly title: string;
  /** One paragraph, shown on People. */
  readonly responsibilities: string;
  /** What the Agent works from. */
  readonly instructions: string;
  /** How the person works on each engine type they set; any other works with the engine's default. */
  readonly engineSettings: PersonEngineSettings;
  readonly capabilities: Capabilities;
  readonly permissionProfile: PermissionProfile;
  /**
   * The rows the card sets (spec §6 › Authority); any other is at the preset's default. Its four
   * named groups are the Hard switches (`hardSwitchesOf`).
   */
  readonly authority: Authority;
  readonly taskLimit: TaskLimit;
  readonly sessionDefault: SessionDefault;
}

/**
 * A card as it comes in: with its Authority, or, from an earlier release or an open Proposal's
 * draft, with only its Hard switches (and both on a card the service answered).
 */
export type IncomingRoleCard = Omit<RoleCard, "authority"> & {
  readonly authority?: Authority;
  readonly hardSwitches?: Partial<HardSwitches>;
};

/**
 * The domain card of an incoming one for the Role `roleKey`: its Authority as given, each pair of
 * equal sides as one value (a value equal to the preset's default stays set), else its Hard switches
 * over `base`, the stored card's Authority on a change and none on a hire
 * (`authorityWithHardSwitches`); with neither, `base`.
 */
export function cardWithAuthority(
  roleKey: string,
  { authority, hardSwitches, ...card }: IncomingRoleCard,
  base: Authority,
): RoleCard {
  return {
    ...card,
    authority:
      authority !== undefined
        ? keptAuthority(authority)
        : hardSwitches !== undefined
          ? authorityWithHardSwitches(roleKey, base, hardSwitches)
          : base,
  };
}

export const NAME_LENGTH = 40;
export const TITLE_LENGTH = 40;
export const RESPONSIBILITIES_LENGTH = 400;
/** Every session of the Role carries them in its cached prefix, so they stay short. */
export const INSTRUCTIONS_LENGTH = 8_000;

/** The card as it is kept: without the spaces around what the user typed. */
export function trimmedRoleCard<Card extends RoleCard>(card: Card): Card {
  return {
    ...card,
    name: card.name.trim(),
    title: card.title.trim(),
    responsibilities: card.responsibilities.trim(),
    instructions: card.instructions.trim(),
  };
}

/** How a person works on one engine type: each null is "Engine's default" (spec §5.4.5). */
export interface EngineTypeSetting {
  readonly model: string | null;
  readonly effort: Effort | null;
}

/**
 * A person's model and effort for each engine type they set, never per account, so they work the
 * same on whichever engine of the type a session lands on.
 */
export type PersonEngineSettings = Partial<Readonly<Record<EngineKind, EngineTypeSetting>>>;

/**
 * What an engine type offers now: whether Settings › Engines lists an engine of it, the models its
 * listed engines offer together and the efforts it takes; Engine answers.
 */
export interface EngineTypeOffer {
  readonly listed: boolean;
  readonly models: readonly string[];
  readonly efforts: readonly Effort[];
}

export type EngineTypesOffered = (type: EngineKind) => EngineTypeOffer;

/**
 * What a card is checked against beyond itself: what each engine type offers, the Roles an
 * Authority row or an MCP tool may consult (`consultableRoleKeys`), and who holds Default Consultant for
 * MCP tool hard switches, if anyone.
 */
export interface RoleCardContext {
  readonly engineTypes: EngineTypesOffered;
  readonly consultable: ReadonlySet<string>;
  readonly mcpConsultant: string | undefined;
  /**
   * The settings the card has now, none for a hire: a type with no engine listed keeps them, as
   * its models can't be told until one is.
   */
  readonly storedEngineSettings?: PersonEngineSettings;
}

/** Why the card of the Role `roleKey` can't be saved, in the UI's words; empty when it can. */
export function roleCardProblems(
  roleKey: string,
  card: RoleCard,
  { engineTypes, consultable, mcpConsultant, storedEngineSettings = {} }: RoleCardContext,
): string[] {
  const problems = [
    ...personNameProblems(card.name),
    ...textProblems(card.title, TITLE_LENGTH, "Give the Role a title.", "A Role's title"),
    ...textProblems(
      card.responsibilities,
      RESPONSIBILITIES_LENGTH,
      "Give the Role's responsibilities in one paragraph.",
      "The responsibilities",
    ),
    ...textProblems(
      card.instructions,
      INSTRUCTIONS_LENGTH,
      "Give the instructions the Agent works from.",
      "The instructions",
    ),
  ];
  if (/\n\s*\n/.test(card.responsibilities.trim()))
    problems.push("The responsibilities are one paragraph.");
  problems.push(...engineSettingsProblems(card.engineSettings, engineTypes, storedEngineSettings));
  const limitProblem = taskLimitProblem(card.taskLimit);
  if (limitProblem) problems.push(limitProblem);
  problems.push(...authorityProblems(roleKey, card.authority, consultable));
  problems.push(
    ...mcpToolSettingsProblems(
      roleKey,
      card.permissionProfile.mcpTools,
      consultable,
      mcpConsultant,
    ),
  );
  problems.push(...builtInCardProblems(roleKey, card));
  return problems;
}

/**
 * Why the person can't work with `settings`: a model the type doesn't offer or an effort it doesn't
 * take, each refused unless it is what `stored` already has.
 */
export function engineSettingsProblems(
  settings: PersonEngineSettings,
  engineTypes: EngineTypesOffered,
  stored: PersonEngineSettings,
): string[] {
  return Object.entries(settings).flatMap(([key, setting]) => {
    const type = key as EngineKind;
    const offer = engineTypes(type);
    const kept = stored[type];
    const name = ENGINE_TYPE_NAMES[type];
    const problems: string[] = [];
    const { model, effort } = setting;
    if (model !== null && model !== kept?.model && !offer.models.includes(model)) {
      problems.push(`Choose a model ${name} offers.`);
    }
    if (effort !== null && effort !== kept?.effort && !offer.efforts.includes(effort)) {
      problems.push(`Choose an effort ${name} takes.`);
    }
    return problems;
  });
}

/** Why a person can't be called `name`; empty when they can. */
export function personNameProblems(name: string): string[] {
  return textProblems(name, NAME_LENGTH, "Give the person a name.", "A person's name");
}

function textProblems(text: string, length: number, empty: string, subject: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [empty];
  if (trimmed.length > length) return [`${subject} may be at most ${length} characters.`];
  return [];
}
