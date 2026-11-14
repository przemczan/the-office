import { dutyFor, type DutyAssignments, type DutyKey } from "./duties.js";
import { presetTitle } from "./presets.js";
import type { RoleCard } from "./role-card.js";
import { roleKeyFor } from "./role-key.js";

/**
 * One person an Office set-up hires (spec §2.2, "Setting up an Office with nobody hired"): into a
 * preset's Role under a name, or from scratch on a whole card with its library skills.
 */
export type SetUpHire =
  | { readonly kind: "hire-from-preset"; readonly roleKey: string; readonly name: string }
  | { readonly kind: "hire"; readonly card: RoleCard; readonly skills: readonly string[] };

/** A duty an Office set-up gives to another Role: the Role key it named when drafted, and the new. */
export interface SetUpDuty {
  readonly duty: DutyKey;
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * The key of the Role a hire fills, known before it exists: the preset's own, or the one the card's
 * title makes, as a duty of the same set-up names it.
 */
export function hiredKeyOf(hire: SetUpHire): string {
  return hire.kind === "hire-from-preset" ? hire.roleKey : roleKeyFor(hire.card.title);
}

/** A hire as the user reads it: "Ada · Developer". */
export function hireWords(hire: SetUpHire): string {
  if (hire.kind === "hire") return `${hire.card.name.trim()} · ${hire.card.title.trim()}`;
  return `${hire.name.trim()} · ${presetTitle(hire.roleKey) ?? hire.roleKey}`;
}

/**
 * Why the set-up can't be made as a whole, in the UI's words; empty when it can. Each hire and each
 * duty is judged apart, by People's hiring and duty rules: this weighs only what they share, that
 * it changes something, that no two hires fill one Role, and that no duty names the Role it goes to
 * already (`named`, the duties the user set; one never set goes to its default Role key).
 */
export function setUpProblems(
  hires: readonly SetUpHire[],
  duties: readonly SetUpDuty[],
  named: DutyAssignments,
): string[] {
  if (hires.length === 0 && duties.length === 0) {
    return ["Nothing to set up: give the people to hire, the duties to assign, or both."];
  }
  return [...duplicateHireProblems(hires), ...unchangedDutyProblems(duties, named)];
}

function duplicateHireProblems(hires: readonly SetUpHire[]): string[] {
  const byKey = new Map<string, SetUpHire[]>();
  for (const hire of hires) {
    const key = hiredKeyOf(hire);
    byKey.set(key, [...(byKey.get(key) ?? []), hire]);
  }
  return [...byKey]
    .filter(([key, same]) => key !== "" && same.length > 1)
    .map(
      ([key, same]) =>
        `${same.map(hireWords).join(" and ")} would fill the same Role "${key}"; hire one person into it.`,
    );
}

/** A duty named twice is refused by the duty rules, as in any change of them. */
function unchangedDutyProblems(duties: readonly SetUpDuty[], named: DutyAssignments): string[] {
  return duties.flatMap(({ duty, to }) => {
    const { label, defaultRoleKey } = dutyFor(duty);
    const namedNow = Object.hasOwn(named, duty) ? named[duty] : defaultRoleKey;
    return namedNow === to ? [`${label} goes to "${to ?? "nobody"}" already; leave it out.`] : [];
  });
}
