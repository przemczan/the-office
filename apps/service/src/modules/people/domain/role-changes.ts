import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { KNOWN_ROLES } from "./known-roles.js";
import { presetFor } from "./presets.js";
import type { Role } from "./role.js";
import {
  personNameProblems,
  roleCardProblems,
  trimmedRoleCard,
  type ModelsOffered,
  type RoleCard,
} from "./role-card.js";
import { roleCardChanges } from "./role-card-changes.js";
import { RoleCardChanged, RoleHired, RoleHiredBack, RoleLetGo } from "./role-events.js";
import { RoleRefused } from "./role-refused.js";

/** A Role after a change, with the event that announces it. */
export interface RoleChange<Event extends DomainEvent> {
  readonly role: Role;
  readonly event: Event;
}

/**
 * Hires `name` into the Role of the preset keyed `roleKey`, with the preset's card, as the user
 * chose it or applied a Proposal of it by the person `proposedBy`. Refuses with every reason, also
 * when `filledBy` already fills the Role: one person fills each.
 */
export function hire(
  roleKey: string,
  name: string,
  filledBy: Role | undefined,
  hiredAt: Date,
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
    letGoAt: undefined,
  };
  return { role, event: new RoleHired(role) };
}

/**
 * Hires the person on `card` into a new Role keyed `roleKey`, which the card's title makes, as the
 * user wrote the card or applied a Proposal of it by the person `proposedBy`. Refuses with every
 * reason: a card that breaks a rule, a key the presets keep, or a Role `filledBy` someone already.
 */
export function hireFromScratch(
  roleKey: string,
  edit: RoleCard,
  modelsOffered: ModelsOffered,
  filledBy: Role | undefined,
  hiredAt: Date,
  proposedBy?: string,
): RoleChange<RoleHired> {
  const card = trimmedRoleCard(edit);
  const problems = roleCardProblems(roleKey, card, modelsOffered);
  const presetTitle = KNOWN_ROLES.get(roleKey);
  if (roleKey === "" && card.title !== "") {
    problems.push("Give the Role a title with letters or digits.");
  } else if (presetTitle) {
    problems.push(`Hire the ${presetTitle} Role from its preset.`);
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
    letGoAt: undefined,
  };
  return { role, event: new RoleHired(role) };
}

/** A person let go still holds their Role's key, with their Memory and chats under it. */
function roleTakenProblem({ card, letGoAt }: Role): string {
  return letGoAt
    ? `${card.name} was let go from the ${card.title} Role; hire ${card.name} back.`
    : `${card.name} already fills the ${card.title} Role.`;
}

/** Lets the person go: refused when they were let go already. */
export function letGo(role: Role, letGoAt: Date): RoleChange<RoleLetGo> {
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
 * Saves the edit as the card's next version, as the user wrote it or applied a Proposal of it by
 * the person `proposedBy`. Undefined when nothing would change; refuses with every reason when the
 * card would break a rule.
 */
export function changeRoleCard(
  role: Role,
  edit: RoleCard,
  modelsOffered: ModelsOffered,
  savedAt: Date,
  proposedBy?: string,
): RoleChange<RoleCardChanged> | undefined {
  if (role.letGoAt) {
    throw new RoleRefused([
      `${role.card.name} was let go from the ${role.card.title} Role; hire ${role.card.name} back to change the Role card.`,
    ]);
  }
  const card = trimmedRoleCard(edit);
  const problems = roleCardProblems(role.key, card, modelsOffered);
  if (problems.length > 0) throw new RoleRefused(problems);
  const changes = roleCardChanges(role.card, card);
  if (changes.length === 0) return undefined;
  const changed: Role = {
    ...role,
    card,
    cardVersion: role.cardVersion + 1,
    cardSavedAt: savedAt,
    cardProposedBy: proposedBy,
  };
  return { role: changed, event: new RoleCardChanged(changed, changes) };
}
