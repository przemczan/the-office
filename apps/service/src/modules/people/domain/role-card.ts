import {
  HARD_SWITCH_KEYS,
  hardSwitchesProblems,
  sameHardSwitchValue,
  type HardSwitches,
  type HardSwitchKey,
} from "./hard-switches.js";
import type { PermissionProfile } from "./permission-profile.js";
import { taskLimitProblem, type TaskLimit } from "./task-limit.js";

/** The engines a Role may work with; `claude -p` as a fallback is tier 2 (spec §5.4). */
export const ENGINES = ["agent-sdk"] as const;
export type Engine = (typeof ENGINES)[number];

/** The models each engine offers, by the engine's own ids. */
export const ENGINE_MODELS: Readonly<Record<Engine, readonly string[]>> = {
  "agent-sdk": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
};

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
}

/**
 * Everything a session of the Role's person needs. Its authority is plain rules in the
 * instructions; its Skills are assigned by the Skills module, keyed by the Role.
 */
export interface RoleCard {
  /** The person's name, as in "Ada · Developer". */
  readonly name: string;
  readonly title: string;
  /** One paragraph, shown on People. */
  readonly description: string;
  /** What the Agent works from. */
  readonly instructions: string;
  readonly engine: Engine;
  /** One of `ENGINE_MODELS` for the engine. */
  readonly model: string;
  readonly effort: Effort;
  readonly capabilities: Capabilities;
  readonly permissionProfile: PermissionProfile;
  readonly hardSwitches: HardSwitches;
  readonly taskLimit: TaskLimit;
  readonly sessionDefault: SessionDefault;
}

/** What the user edits on a Role card: all but the permission profile, editable in tier 2. */
export type RoleCardEdit = Omit<RoleCard, "permissionProfile">;

export const NAME_LENGTH = 40;
export const TITLE_LENGTH = 40;
export const DESCRIPTION_LENGTH = 400;
/** Every session of the Role carries them in its cached prefix, so they stay short. */
export const INSTRUCTIONS_LENGTH = 8_000;

/** The card as it is kept: without the spaces around what the user typed. */
export function trimmedRoleCard<Card extends RoleCardEdit>(card: Card): Card {
  return {
    ...card,
    name: card.name.trim(),
    title: card.title.trim(),
    description: card.description.trim(),
    instructions: card.instructions.trim(),
  };
}

/** Why the card of the Role `roleKey` can't be saved, in the UI's words; empty when it can. */
export function roleCardProblems(roleKey: string, card: RoleCardEdit): string[] {
  const problems = [
    ...personNameProblems(card.name),
    ...textProblems(card.title, TITLE_LENGTH, "Give the Role a title.", "A Role's title"),
    ...textProblems(
      card.description,
      DESCRIPTION_LENGTH,
      "Describe the Role in one paragraph.",
      "The description",
    ),
    ...textProblems(
      card.instructions,
      INSTRUCTIONS_LENGTH,
      "Give the instructions the Agent works from.",
      "The instructions",
    ),
  ];
  if (/\n\s*\n/.test(card.description.trim())) problems.push("The description is one paragraph.");
  if (!ENGINE_MODELS[card.engine].includes(card.model)) {
    problems.push("Choose a model the engine offers.");
  }
  if (card.capabilities.sharedMemory) {
    problems.push("Shared memory stays off until The Office can keep it.");
  }
  const limitProblem = taskLimitProblem(card.taskLimit);
  if (limitProblem) problems.push(limitProblem);
  problems.push(...hardSwitchesProblems(roleKey, card.hardSwitches));
  return problems;
}

const CAPABILITY_KEYS = [
  "sharedMemory",
  "chat",
  "consultant",
] as const satisfies readonly (keyof Capabilities)[];
const PLAIN_FIELDS = [
  "name",
  "title",
  "description",
  "instructions",
  "engine",
  "model",
  "effort",
  "taskLimit",
  "sessionDefault",
] as const;

/** A part of a Role card as its change history names it, down to each capability and switch. */
export type RoleCardField =
  | (typeof PLAIN_FIELDS)[number]
  | `capabilities.${(typeof CAPABILITY_KEYS)[number]}`
  | "permissionProfile"
  | `hardSwitches.${HardSwitchKey}`;

/** What differs from `before` to `after`, in the card's order. */
export function changedRoleCardFields(before: RoleCard, after: RoleCard): RoleCardField[] {
  const changed: RoleCardField[] = PLAIN_FIELDS.filter((field) => before[field] !== after[field]);
  for (const key of CAPABILITY_KEYS) {
    if (before.capabilities[key] !== after.capabilities[key]) changed.push(`capabilities.${key}`);
  }
  if (!samePermissionProfile(before.permissionProfile, after.permissionProfile)) {
    changed.push("permissionProfile");
  }
  for (const key of HARD_SWITCH_KEYS) {
    if (!sameHardSwitchValue(before.hardSwitches[key], after.hardSwitches[key])) {
      changed.push(`hardSwitches.${key}`);
    }
  }
  return changed;
}

function samePermissionProfile(first: PermissionProfile, second: PermissionProfile): boolean {
  return first.edit === second.edit && first.run === second.run && first.web === second.web;
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
