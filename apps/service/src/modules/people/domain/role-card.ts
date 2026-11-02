import type { EngineId } from "../../engine/index.js";
import { hardSwitchesProblems, type HardSwitches } from "./hard-switches.js";
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
  readonly responsibilities: string;
  /** What the Agent works from. */
  readonly instructions: string;
  /** One of the engines Settings › Engines lists, by its id. */
  readonly engine: EngineId;
  /** One of the models the engine offers, by its id there. */
  readonly model: string;
  readonly effort: Effort;
  readonly capabilities: Capabilities;
  readonly permissionProfile: PermissionProfile;
  readonly hardSwitches: HardSwitches;
  readonly taskLimit: TaskLimit;
  readonly sessionDefault: SessionDefault;
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

/**
 * Why the card of the Role `roleKey` can't be saved, in the UI's words; empty when it can.
 * `offeredModels` are the models the card's engine offers now, which the Engine module answers.
 */
export function roleCardProblems(
  roleKey: string,
  card: RoleCard,
  offeredModels: readonly string[],
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
  if (!offeredModels.includes(card.model)) {
    problems.push("Choose a model the engine offers.");
  }
  const limitProblem = taskLimitProblem(card.taskLimit);
  if (limitProblem) problems.push(limitProblem);
  problems.push(...hardSwitchesProblems(roleKey, card.hardSwitches));
  problems.push(...mcpToolSettingsProblems(roleKey, card.permissionProfile.mcpTools));
  return problems;
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
