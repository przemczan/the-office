import { KNOWN_ROLES } from "./known-roles.js";

/** The actions that need someone's say whatever the Agent thinks (spec §2.2, §6). */
export const HARD_SWITCH_KEYS = [
  "runInstalls",
  "publishOutsideThePipeline",
  "changeRoles",
] as const;
export type HardSwitchKey = (typeof HARD_SWITCH_KEYS)[number];

export const HARD_SWITCH_LABELS: Readonly<Record<HardSwitchKey, string>> = {
  runInstalls: "Run installs",
  publishOutsideThePipeline: "Publish outside the Pipeline",
  changeRoles: "Change Roles",
};

/**
 * Who sees to a Hard switch: The Office in code, or the Agent, told in plain words by its brief and
 * asking through the consult tool, since The Office stays agnostic of each Project's stack (spec §6).
 */
export type HardSwitchEnforcement = "enforced" | "followed";

export const HARD_SWITCH_ENFORCEMENT: Readonly<Record<HardSwitchKey, HardSwitchEnforcement>> = {
  runInstalls: "followed",
  publishOutsideThePipeline: "followed",
  changeRoles: "enforced",
};

/** A Consult value names the Role to consult, by its key, so it holds before anyone fills it. */
export type HardSwitchValue =
  | { readonly kind: "allowed" }
  | { readonly kind: "consult"; readonly role: string }
  | { readonly kind: "ask-me" }
  | { readonly kind: "never" };

export type HardSwitches = Readonly<Record<HardSwitchKey, HardSwitchValue>>;

export const ALLOWED: HardSwitchValue = { kind: "allowed" };
export const ASK_ME: HardSwitchValue = { kind: "ask-me" };
export const NEVER: HardSwitchValue = { kind: "never" };

export function consult(role: string): HardSwitchValue {
  return { kind: "consult", role };
}

/** Why a Role's Hard switches can't be saved, in the UI's words; empty when they can. */
export function hardSwitchesProblems(roleKey: string, switches: HardSwitches): string[] {
  const problems: string[] = [];
  for (const key of HARD_SWITCH_KEYS) {
    const value = switches[key];
    const label = HARD_SWITCH_LABELS[key];
    if (value.kind === "consult" && !KNOWN_ROLES.has(value.role)) {
      problems.push(`${label} consults a Role The Office doesn't know.`);
    } else if (value.kind === "consult" && value.role === roleKey) {
      problems.push(`${label} can't consult the Role itself.`);
    }
  }
  return problems;
}

/**
 * What a switch amounts to while `hiredRoles` are filled: a missing person falls back to the user,
 * so consulting a Role nobody fills asks the user until someone is hired (spec §2.2).
 */
export function hardSwitchInEffect(
  value: HardSwitchValue,
  hiredRoles: ReadonlySet<string>,
): HardSwitchValue {
  return value.kind === "consult" && !hiredRoles.has(value.role) ? ASK_ME : value;
}

/** The switches that consult a Role nobody fills, and so ask the user until someone is hired. */
export function switchesAskingYouUntilHired(
  switches: HardSwitches,
  hiredRoles: ReadonlySet<string>,
): HardSwitchKey[] {
  return HARD_SWITCH_KEYS.filter((key) => {
    const value = switches[key];
    return value.kind === "consult" && hardSwitchInEffect(value, hiredRoles) !== value;
  });
}

export function sameHardSwitchValue(first: HardSwitchValue, second: HardSwitchValue): boolean {
  if (first.kind === "consult" && second.kind === "consult") return first.role === second.role;
  return first.kind === second.kind;
}
