import { isBuiltIn } from "./caretaker.js";
import { ASK_ME, consult, type HardSwitchValue } from "./hard-switches.js";
import { CTO, DEVELOPER, DEVOPS, OFFICE_MANAGER, PLANNER, REVIEWER } from "./known-roles.js";
import type { Role } from "./role.js";

/**
 * What applies while nobody holds a duty (spec §2.2, "Duties"): the user is asked, the Caretaker
 * stands in, or the Pipelines whose Stages name the duty are unstaffed.
 */
export type DutyFallback = "user" | "caretaker" | "unstaffed";

/** A built-in job The Office gives to whichever hired Role holds it (spec §2.2). */
export interface Duty {
  readonly key: string;
  readonly label: string;
  /** Who holds it while it was never set, if hired. */
  readonly defaultRoleKey: string;
  readonly fallback: DutyFallback;
}

/** Spec §2.2's duties, in its order. */
export const DUTIES = [
  {
    key: "default-person-to-talk-to",
    label: "Default person to talk to",
    defaultRoleKey: OFFICE_MANAGER,
    fallback: "caretaker",
  },
  {
    key: "shapes-initiatives",
    label: "Shapes Initiatives",
    defaultRoleKey: CTO,
    fallback: "user",
  },
  {
    key: "asked-first-when-out-of-tries",
    label: "Asked first when a Stage runs out of tries",
    defaultRoleKey: CTO,
    fallback: "user",
  },
  {
    key: "onboards-projects",
    label: "Onboards and repairs Projects",
    defaultRoleKey: DEVOPS,
    fallback: "user",
  },
  {
    key: "mcp-tool-consultant",
    label: "Default Consultant for MCP tool hard switches",
    defaultRoleKey: DEVOPS,
    fallback: "user",
  },
  { key: "plans", label: "Plans", defaultRoleKey: PLANNER, fallback: "user" },
  { key: "implements", label: "Implements", defaultRoleKey: DEVELOPER, fallback: "unstaffed" },
  { key: "reviews", label: "Reviews", defaultRoleKey: REVIEWER, fallback: "unstaffed" },
] as const satisfies readonly Duty[];

export type DutyKey = (typeof DUTIES)[number]["key"];

/**
 * The duties the user set, each to a Role key or to `null` for none; a duty never set is missing,
 * and so held by its default Role key.
 */
export type DutyAssignments = Readonly<Partial<Record<DutyKey, string | null>>>;

/** Who holds a duty now, and what applies while nobody does. */
export interface DutyHolding {
  readonly duty: DutyKey;
  readonly label: string;
  readonly defaultRoleKey: string;
  /** Whether the user set it; when not, `roleKey` is the default. */
  readonly set: boolean;
  /** The Role key it names, hired or not; `null` when set to none. */
  readonly roleKey: string | null;
  /** `roleKey` while that Role is hired, else `null`. */
  readonly holder: string | null;
  /** What applies while there is no holder, else `null`. */
  readonly fallback: DutyFallback | null;
}

export function isDutyKey(key: string): key is DutyKey {
  return DUTIES.some((duty) => duty.key === key);
}

export function dutyFor(key: DutyKey): Duty {
  const duty = DUTIES.find((each) => each.key === key);
  if (!duty) throw new Error(`No duty ${key}`);
  return duty;
}

/**
 * The keys of the Roles that may hold a duty: hired and not let go, never the Caretaker. A holder
 * outside them counts as nobody, so letting a Role go leaves its duties unheld and hiring it back
 * restores them (spec §2.2, "Who holds a duty").
 */
export function hiredKeysOf(roles: readonly Role[]): ReadonlySet<string> {
  return new Set(
    roles.filter((role) => !role.letGoAt && !isBuiltIn(role.key)).map((role) => role.key),
  );
}

export function dutyHolding(
  key: DutyKey,
  assignments: DutyAssignments,
  hiredKeys: ReadonlySet<string>,
): DutyHolding {
  const duty = dutyFor(key);
  const stored = assignments[key];
  const set = stored !== undefined;
  const roleKey = set ? stored : duty.defaultRoleKey;
  const holder = roleKey !== null && hiredKeys.has(roleKey) ? roleKey : null;
  return {
    duty: key,
    label: duty.label,
    defaultRoleKey: duty.defaultRoleKey,
    set,
    roleKey,
    holder,
    fallback: holder === null ? duty.fallback : null,
  };
}

/** Every duty's holding, in `DUTIES` order. */
export function dutyHoldings(
  assignments: DutyAssignments,
  hiredKeys: ReadonlySet<string>,
): DutyHolding[] {
  return DUTIES.map((duty) => dutyHolding(duty.key, assignments, hiredKeys));
}

/** The duties the Role keyed `roleKey` holds now, in `DUTIES` order. */
export function dutiesHeldBy(
  roleKey: string,
  assignments: DutyAssignments,
  hiredKeys: ReadonlySet<string>,
): DutyKey[] {
  return dutyHoldings(assignments, hiredKeys)
    .filter((holding) => holding.holder === roleKey)
    .map((holding) => holding.duty);
}

/**
 * Where an MCP tool the user never set stands (spec §6): consulting whoever holds Default
 * Consultant for MCP tool hard switches, or asking the user while nobody does.
 */
export function mcpToolDefault(holder: string | undefined): HardSwitchValue {
  return holder === undefined ? ASK_ME : consult(holder);
}

/**
 * Why `duty` can't be set to `roleKey`, in the UI's words; empty when it can. None is always
 * allowed; a Role must be hired, and the Caretaker holds no duty.
 */
export function dutyChangeProblems(
  duty: string,
  roleKey: string | null,
  hiredKeys: ReadonlySet<string>,
): string[] {
  if (!isDutyKey(duty)) return [`The Office has no duty "${duty}".`];
  if (roleKey === null) return [];
  const { label } = dutyFor(duty);
  if (isBuiltIn(roleKey)) return [`The Caretaker is built in and holds no duty, so not ${label}.`];
  if (!hiredKeys.has(roleKey)) {
    return [`${label} goes to a hired Role, and nobody is hired as "${roleKey}".`];
  }
  return [];
}
