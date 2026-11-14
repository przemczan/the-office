import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { EngineModel } from "../../engine/index.js";
import type { Avatar } from "./avatar.js";
import { isBuiltIn } from "./caretaker.js";
import { mcpToolDefault } from "./duties.js";
import { presetFor, presetTitle } from "./presets.js";
import type { Role } from "./role.js";
import {
  personNameProblems,
  roleCardProblems,
  trimmedRoleCard,
  type RoleCard,
  type RoleCardContext,
} from "./role-card.js";
import { roleCardChanges } from "./role-card-changes.js";
import {
  RoleAvatarChanged,
  RoleCardChanged,
  RoleHired,
  RoleHiredBack,
  RoleLetGo,
} from "./role-events.js";
import { RoleRefused } from "./role-refused.js";
import type { UserRef } from "./user.js";

/** A Role after a change, with the event that announces it. */
export interface RoleChange<Event extends DomainEvent> {
  readonly role: Role;
  readonly event: Event;
}

/**
 * Hires `name` into the Role of the preset keyed `roleKey`, with the preset's card, as the user
 * `savedBy` chose it or applied a Proposal of it by the person `proposedBy`. Refuses with every reason, also
 * when `filledBy` already fills the Role: one person fills each.
 */
export function hire(
  roleKey: string,
  name: string,
  filledBy: Role | undefined,
  hiredAt: Date,
  savedBy: UserRef | null,
  proposedBy?: string,
): RoleChange<RoleHired> {
  const preset = presetFor(roleKey);
  if (!preset) throw new RoleRefused([`There is no preset to hire a "${roleKey}" from.`]);
  const problems = personNameProblems(name);
  if (filledBy) problems.push(roleTakenProblem(filledBy));
  if (problems.length > 0) throw new RoleRefused(problems);
  const role: Role = {
    key: preset.roleKey,
    card: { ...preset.card, name: name.trim() },
    cardVersion: 1,
    hiredAt,
    cardSavedAt: hiredAt,
    cardProposedBy: proposedBy,
    cardSavedBy: savedBy,
    letGoAt: undefined,
    avatar: null,
  };
  return { role, event: new RoleHired(role) };
}

/**
 * Hires the person on `card` into a new Role keyed `roleKey`, which the card's title makes, as the
 * user `savedBy` wrote the card or applied a Proposal of it by the person `proposedBy`. Refuses with every
 * reason: a card that breaks a rule, a key the presets or the Caretaker keep, or a Role `filledBy`
 * someone already.
 */
export function hireFromScratch(
  roleKey: string,
  edit: RoleCard,
  context: RoleCardContext,
  filledBy: Role | undefined,
  hiredAt: Date,
  savedBy: UserRef | null,
  proposedBy?: string,
): RoleChange<RoleHired> {
  const card = trimmedRoleCard(edit);
  const problems = roleCardProblems(roleKey, card, context);
  const presetsOwnTitle = presetTitle(roleKey);
  if (roleKey === "" && card.title !== "") {
    problems.push("Give the Role a title with letters or digits.");
  } else if (presetsOwnTitle) {
    problems.push(`Hire the ${presetsOwnTitle} Role from its preset.`);
  } else if (isBuiltIn(roleKey)) {
    problems.push("The Caretaker is built in: nobody else is hired into their Role.");
  } else if (filledBy) {
    problems.push(roleTakenProblem(filledBy));
  }
  if (problems.length > 0) throw new RoleRefused(problems);
  const role: Role = {
    key: roleKey,
    card,
    cardVersion: 1,
    hiredAt,
    cardSavedAt: hiredAt,
    cardProposedBy: proposedBy,
    cardSavedBy: savedBy,
    letGoAt: undefined,
    avatar: null,
  };
  return { role, event: new RoleHired(role) };
}

/** A person let go still holds their Role's key, with their Memory and chats under it. */
function roleTakenProblem({ card, letGoAt }: Role): string {
  return letGoAt
    ? `${card.name} was let go from the ${card.title} Role; hire ${card.name} back.`
    : `${card.name} already fills the ${card.title} Role.`;
}

/** Lets the person go: refused when they were let go already, and for the built-in Caretaker. */
export function letGo(role: Role, letGoAt: Date): RoleChange<RoleLetGo> {
  if (isBuiltIn(role.key)) {
    throw new RoleRefused([`${role.card.name} is the built-in Caretaker: never let go.`]);
  }
  if (role.letGoAt) {
    throw new RoleRefused([
      `${role.card.name} was let go from the ${role.card.title} Role already.`,
    ]);
  }
  const changed: Role = { ...role, letGoAt };
  return { role: changed, event: new RoleLetGo(changed, letGoAt) };
}

/** Hires the person let go back into their Role, as they were. */
export function hireBack(role: Role, hiredBackAt: Date): RoleChange<RoleHiredBack> {
  if (!role.letGoAt) {
    throw new RoleRefused([
      `${role.card.name} fills the ${role.card.title} Role; nobody was let go.`,
    ]);
  }
  const changed: Role = { ...role, letGoAt: undefined };
  return { role: changed, event: new RoleHiredBack(changed, hiredBackAt) };
}

/**
 * Saves the edit as the card's next version, as the user `savedBy` wrote it or applied a Proposal
 * of it by the person `proposedBy`, or as that person changed it on their own (`savedBy` null).
 * Undefined when nothing would change; refuses with every reason when the
 * card would break a rule.
 */
export function changeRoleCard(
  role: Role,
  edit: RoleCard,
  context: RoleCardContext,
  savedAt: Date,
  savedBy: UserRef | null,
  proposedBy?: string,
): RoleChange<RoleCardChanged> | undefined {
  if (role.letGoAt) {
    throw new RoleRefused([
      `${role.card.name} was let go from the ${role.card.title} Role; hire ${role.card.name} back to change the Role card.`,
    ]);
  }
  const card = trimmedRoleCard(edit);
  const problems = roleCardProblems(role.key, card, context);
  if (problems.length > 0) throw new RoleRefused(problems);
  const changes = roleCardChanges(role.card, card, mcpToolDefault(context.mcpConsultant));
  if (changes.length === 0) return undefined;
  const changed: Role = {
    ...role,
    card,
    cardVersion: role.cardVersion + 1,
    cardSavedAt: savedAt,
    cardProposedBy: proposedBy,
    cardSavedBy: savedBy,
  };
  return { role: changed, event: new RoleCardChanged(changed, changes) };
}

/**
 * Saves the card as its next version with its Role override where `move` puts it, as the user
 * removing an engine moves it (spec §5.4), to none with the only engine; undefined when the
 * override stays. A let-go Role's card moves too, as hiring the person back restores it. The
 * version names no user: Engine's removal doesn't say who removed the engine.
 */
export function moveRoleOverride(
  role: Role,
  move: (reference: EngineModel) => EngineModel | null,
  savedAt: Date,
): RoleChange<RoleCardChanged> | undefined {
  const { roleOverride } = role.card;
  if (roleOverride === null) return undefined;
  const moved = move(roleOverride);
  if (moved && sameEngineModel(moved, roleOverride)) return undefined;
  const card = { ...role.card, roleOverride: moved };
  const changed: Role = {
    ...role,
    card,
    cardVersion: role.cardVersion + 1,
    cardSavedAt: savedAt,
    cardProposedBy: undefined,
    cardSavedBy: null,
  };
  return {
    role: changed,
    event: new RoleCardChanged(changed, [{ field: "roleOverride", from: roleOverride, to: moved }]),
  };
}

/**
 * Gives the person `avatar`, or none, leaving the card and its versions alone. Undefined when they
 * have none to remove; refused for someone let go, whose page is read-only until hired back.
 */
export function changeAvatar(
  role: Role,
  avatar: Avatar | null,
  changedAt: Date,
): RoleChange<RoleAvatarChanged> | undefined {
  const { name, title } = role.card;
  if (role.letGoAt) {
    throw new RoleRefused([
      `${name} was let go from the ${title} Role; hire ${name} back to change their Avatar.`,
    ]);
  }
  if (role.avatar?.id === avatar?.id) return undefined;
  const changed: Role = { ...role, avatar };
  return { role: changed, event: new RoleAvatarChanged(changed, changedAt) };
}

function sameEngineModel(one: EngineModel, other: EngineModel | null): boolean {
  return one.engineId === other?.engineId && one.model === other.model;
}
