import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { DutyKey } from "./duties.js";
import type { HardSwitches } from "./hard-switches.js";
import {
  effortsTakenBy,
  type Engine,
  type EngineKind,
  type EngineModel,
} from "../../engine/index.js";
import { authorityMovedOver, instructionsMovedOver } from "./authority-move-over.js";
import { authorityInEffect, PROPOSAL } from "./authority.js";
import { jobSettingsOfDutiesMissingOn } from "./duty-jobs.js";
import type { Avatar } from "./avatar.js";
import { isBuiltIn } from "./caretaker.js";
import { mcpToolDefault } from "./duties.js";
import { ENGINE_TYPES } from "./engine-type-offers.js";
import { dutiesSuitedTo, presetFor, presetTitle } from "./presets.js";
import type { Role } from "./role.js";
import {
  personNameProblems,
  roleCardProblems,
  trimmedRoleCard,
  type Effort,
  type EngineTypeSetting,
  type PersonEngineSettings,
  type RoleCard,
  type RoleCardContext,
} from "./role-card.js";
import {
  authorityChanges,
  roleCardChanges,
  type RoleCardFieldChange,
} from "./role-card-changes.js";
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
  // The jobs of the duties the preset holds by default, which its table doesn't give (the Planner's
  // Plans), are set on its card as it is hired, as Settings › Duties gives them to a new holder.
  const jobs = jobSettingsOfDutiesMissingOn(
    preset.roleKey,
    preset.card.authority,
    dutiesSuitedTo(preset),
  );
  const role: Role = {
    key: preset.roleKey,
    card: {
      ...preset.card,
      name: name.trim(),
      authority: { ...preset.card.authority, ...jobs },
    },
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
 * What a card saved before it had `engineSettings` held of how its person worked: the Role override
 * (an engine and model, none for the Office default) and one effort. Stored still, unread, so a
 * rollback to the release before finds them (spec §5.4.5, "Moving the earlier engine settings over").
 */
export interface EarlierEngineFields {
  readonly roleOverride?: EngineModel | null;
  readonly effort?: Effort;
}

/** The engine settings the earlier fields move over to, with the Changes entries saying so. */
export interface EngineSettingsMove {
  readonly engineSettings: PersonEngineSettings;
  readonly changes: readonly RoleCardFieldChange[];
}

/**
 * Moves `earlier` over to engine settings, with `engines` the engines listed now: the effort goes
 * on every engine type that takes it, listed or not, and a Role override on a listed engine becomes
 * the person's model on its type, its account dropped; one on an engine no longer listed has no
 * type to move to and is dropped. Changes says the settings moved over, first, and then names the
 * whole settings. The moved-over entry goes from the Role override, or none, to the engine type its
 * model moved to, or none when there was no override or it was dropped.
 */
export function moveEngineSettingsOver(
  earlier: EarlierEngineFields,
  engines: readonly Engine[],
): EngineSettingsMove {
  const { roleOverride = null, effort } = earlier;
  const takingEffort = (type: EngineKind): Effort | null =>
    effort !== undefined && effortsTakenBy(type).includes(effort) ? effort : null;
  const settings: Partial<Record<EngineKind, EngineTypeSetting>> = {};
  for (const type of ENGINE_TYPES) {
    const typeEffort = takingEffort(type);
    if (typeEffort !== null) settings[type] = { model: null, effort: typeEffort };
  }
  const overridden = roleOverride && engines.find(({ id }) => id === roleOverride.engineId);
  if (roleOverride && overridden) {
    settings[overridden.kind] = {
      model: roleOverride.model,
      effort: takingEffort(overridden.kind),
    };
  }
  return {
    engineSettings: settings,
    changes: [
      { field: "engineSettingsMovedOver", from: roleOverride, to: overridden?.kind ?? null },
      { field: "engineSettings", from: {}, to: settings },
    ],
  };
}

/**
 * Saves the card as its next version with `earlier` moved over to engine settings, as the service
 * starting after the update does, a let-go Role's and the Caretaker's too. The version names no user
 * and nobody proposed it.
 */
export function engineSettingsMovedOver(
  role: Role,
  earlier: EarlierEngineFields,
  engines: readonly Engine[],
  savedAt: Date,
): RoleChange<RoleCardChanged> {
  const { engineSettings, changes } = moveEngineSettingsOver(earlier, engines);
  const changed: Role = {
    ...role,
    card: { ...role.card, engineSettings },
    cardVersion: role.cardVersion + 1,
    cardSavedAt: savedAt,
    cardProposedBy: undefined,
    cardSavedBy: null,
  };
  return { role: changed, event: new RoleCardChanged(changed, changes) };
}

/**
 * Saves the card as its next version with its Authority made from `switches`, its Hard switches as
 * kept, and `holds`, the duties the Role holds now (`authorityMovedOver`), and its instructions
 * without the preset's earlier authority sentences when they are word for word
 * (`instructionsMovedOver`), as the service starting after the update that brings Authority does, a
 * let-go Role's and the Caretaker's too. Its Changes say the Authority moved over, first, then each
 * row and the instructions changed. The version names no user and nobody proposed it.
 */
export function authorityMovedOverOf(
  role: Role,
  switches: HardSwitches,
  holds: ReadonlySet<DutyKey>,
  savedAt: Date,
): RoleChange<RoleCardChanged> {
  const authority = authorityMovedOver(role.key, switches, holds);
  const instructions = instructionsMovedOver(role.key, role.card.instructions);
  const changes: RoleCardFieldChange[] = [
    { field: "authorityMovedOver", from: null, to: null },
    ...authorityChanges(role.card.authority, authority),
    ...(instructions === role.card.instructions
      ? []
      : [{ field: "instructions" as const, from: role.card.instructions, to: instructions }]),
  ];
  const changed: Role = {
    ...role,
    card: { ...role.card, authority, instructions },
    cardVersion: role.cardVersion + 1,
    cardSavedAt: savedAt,
    cardProposedBy: undefined,
    cardSavedBy: null,
  };
  return { role: changed, event: new RoleCardChanged(changed, changes) };
}

/**
 * The second move-over (spec §2.2, "Duty"): the Role's card gives back the reach its duties used to
 * grant on top of its Authority. Each row of the held duties' jobs that the card's Authority in
 * effect leaves Never (`jobSettingsOfDutiesMissingOn`) is set at the job's setting; every other row
 * stays as it is. Undefined when the card gives its whole job, so a second run changes nothing.
 * Its Changes say the Authority came from the duties held, first, then each row set. The version
 * names no user and nobody proposed it.
 */
export function authorityFromDutiesHeldOf(
  role: Role,
  holds: ReadonlySet<DutyKey>,
  savedAt: Date,
): RoleChange<RoleCardChanged> | undefined {
  const missing = jobSettingsOfDutiesMissingOn(role.key, role.card.authority, holds);
  if (Object.keys(missing).length === 0) return undefined;
  const authority = { ...role.card.authority, ...missing };
  const changes: RoleCardFieldChange[] = [
    { field: "authorityFromDutiesHeld", from: null, to: null },
    ...authorityChanges(role.card.authority, authority),
  ];
  const changed: Role = {
    ...role,
    card: { ...role.card, authority },
    cardVersion: role.cardVersion + 1,
    cardSavedAt: savedAt,
    cardProposedBy: undefined,
    cardSavedBy: null,
  };
  return { role: changed, event: new RoleCardChanged(changed, changes) };
}

/**
 * The third move-over (spec 5.4.1, "Per-kind Proposal tools fold in"): the tools
 * `propose_project_commands`, `propose_test_targets` and `propose_actions` are retired, and `change_project_settings`
 * ruled Proposal takes their place. A Role whose card kept one of their rows at Proposal and leaves
 * Change Project settings Never would lose that reach, so it is set to Proposal. Undefined when the
 * card leaves Change Project settings freer than Never, so nothing else changes. Its Changes say
 * the Proposal rows were moved over, first, then the row set. The version names no user and nobody
 * proposed it.
 */
export function projectSettingProposalsMovedOverOf(
  role: Role,
  savedAt: Date,
): RoleChange<RoleCardChanged> | undefined {
  if (authorityInEffect(role.key, role.card.authority).changeProjectSettings.kind !== "never") {
    return undefined;
  }
  const authority = { ...role.card.authority, changeProjectSettings: PROPOSAL };
  const changes: RoleCardFieldChange[] = [
    { field: "projectSettingProposalsMovedOver", from: null, to: null },
    ...authorityChanges(role.card.authority, authority),
  ];
  const changed: Role = {
    ...role,
    card: { ...role.card, authority },
    cardVersion: role.cardVersion + 1,
    cardSavedAt: savedAt,
    cardProposedBy: undefined,
    cardSavedBy: null,
  };
  return { role: changed, event: new RoleCardChanged(changed, changes) };
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
