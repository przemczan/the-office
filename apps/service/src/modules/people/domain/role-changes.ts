import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { presetFor } from "./presets.js";
import type { Role } from "./role.js";
import {
  personNameProblems,
  roleCardProblems,
  trimmedRoleCard,
  type RoleCard,
  type RoleCardEdit,
} from "./role-card.js";
import { roleCardChanges } from "./role-card-changes.js";
import { RoleCardChanged, RoleHired } from "./role-events.js";
import { RoleRefused } from "./role-refused.js";

/** A Role after a change, with the event that announces it. */
export interface RoleChange<Event extends DomainEvent> {
  readonly role: Role;
  readonly event: Event;
}

/**
 * Hires `name` into the Role of the preset keyed `roleKey`, with the preset's card. Refuses with
 * every reason, also when `filledBy` already fills the Role: one person fills each.
 */
export function hire(
  roleKey: string,
  name: string,
  filledBy: Role | undefined,
  hiredAt: Date,
): RoleChange<RoleHired> {
  const preset = presetFor(roleKey);
  if (!preset) throw new RoleRefused([`There is no preset to hire a "${roleKey}" from.`]);
  const problems = personNameProblems(name);
  if (filledBy) {
    problems.push(`${filledBy.card.name} already fills the ${filledBy.card.title} Role.`);
  }
  if (problems.length > 0) throw new RoleRefused(problems);
  const role: Role = {
    key: preset.roleKey,
    card: { ...preset.card, name: name.trim() },
    cardVersion: 1,
    hiredAt,
    cardSavedAt: hiredAt,
  };
  return { role, event: new RoleHired(role) };
}

/**
 * Saves the edit as the card's next version. Undefined when nothing would change; refuses with
 * every reason when the card would break a rule.
 */
export function changeRoleCard(
  role: Role,
  edit: RoleCardEdit,
  savedAt: Date,
): RoleChange<RoleCardChanged> | undefined {
  const card: RoleCard = {
    ...trimmedRoleCard(edit),
    permissionProfile: role.card.permissionProfile,
  };
  const problems = roleCardProblems(role.key, card);
  if (problems.length > 0) throw new RoleRefused(problems);
  const changes = roleCardChanges(role.card, card);
  if (changes.length === 0) return undefined;
  const changed: Role = { ...role, card, cardVersion: role.cardVersion + 1, cardSavedAt: savedAt };
  return { role: changed, event: new RoleCardChanged(changed, changes) };
}
