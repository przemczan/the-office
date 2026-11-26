import { hardSwitchesOf } from "./authority.js";
import type { HardSwitches } from "./hard-switches.js";
import { DEVOPS } from "./known-roles.js";
import { consultableRoleKeys, presetFor } from "./presets.js";
import type { Role } from "./role.js";
import { effortsTakenBy } from "../../engine/index.js";
import type { EngineTypesOffered, RoleCard, RoleCardContext } from "./role-card.js";

/** The models the fixture Claude Code engines offer. */
export const OFFERED_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** Claude Code listed with the fixture models; every other type listed by no engine. */
export const ENGINE_TYPES_OFFERED: EngineTypesOffered = (type) =>
  type === "claude-code"
    ? { listed: true, models: OFFERED_MODELS, efforts: effortsTakenBy(type) }
    : { listed: false, models: [], efforts: effortsTakenBy(type) };

/**
 * A card checked as with no duty set and nobody hired from scratch: Claude Code listed with the fixture
 * models, the presets' Roles to consult, and Devops holding Default Consultant for MCP tool hard switches.
 */
export const CARD_CONTEXT: RoleCardContext = {
  engineTypes: ENGINE_TYPES_OFFERED,
  consultable: consultableRoleKeys([]),
  mcpConsultant: DEVOPS,
};

/** The Developer preset's card, named Ada. */
export function aRoleCard(fields: Partial<RoleCard> = {}): RoleCard {
  const preset = presetFor("developer");
  if (!preset) throw new Error("The Developer preset is missing.");
  return { ...preset.card, name: "Ada", ...fields };
}

/**
 * The Developer preset's card named Ada as the web sends it: its Authority, and its Hard switches in
 * step for the release before.
 */
export function aCardToSend(
  fields: Partial<RoleCard> = {},
): RoleCard & { readonly hardSwitches: HardSwitches } {
  const card = aRoleCard(fields);
  return { ...card, hardSwitches: hardSwitchesOf("developer", card.authority) };
}

/**
 * The Developer preset's card named Ada as the release before Authority saved it: its Hard switches
 * (the preset's by default), no Authority.
 */
export function aCardSavedBeforeAuthority(
  fields: Partial<Omit<RoleCard, "authority">> & { hardSwitches?: HardSwitches } = {},
): Omit<RoleCard, "authority"> & { readonly hardSwitches: HardSwitches } {
  const { authority: _authority, ...card } = aRoleCard();
  return { ...card, hardSwitches: hardSwitchesOf("developer", {}), ...fields };
}

export function aRole(fields: Partial<Role> = {}): Role {
  const hiredAt = new Date("2026-10-25T09:00:00.000Z");
  return {
    key: "developer",
    card: aRoleCard(),
    cardVersion: 1,
    hiredAt,
    cardSavedAt: hiredAt,
    cardProposedBy: undefined,
    cardSavedBy: null,
    letGoAt: undefined,
    avatar: null,
    ...fields,
  };
}
