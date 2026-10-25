import type { RoleSkillsChange } from "../../skills/index.js";
import type { RoleCardVersion } from "../domain/role.js";
import type { RoleCardFieldChange } from "../domain/role-card-changes.js";

/** One line of a person's change history: the hire, a card change or a change of skills. */
export type RoleHistoryEntry =
  | { readonly kind: "hired"; readonly at: Date }
  | {
      readonly kind: "card-changed";
      readonly at: Date;
      readonly cardVersion: number;
      readonly changes: readonly RoleCardFieldChange[];
    }
  | {
      readonly kind: "skills-changed";
      readonly at: Date;
      readonly added: readonly string[];
      readonly removed: readonly string[];
    };

/**
 * The card's versions and the Role's skill changes since `hiredAt`, kept by Skills, as one
 * history, newest first; a skill change saved with a card change comes after it.
 */
export function roleHistory(
  hiredAt: Date,
  versions: readonly RoleCardVersion[],
  skillChanges: readonly RoleSkillsChange[],
): RoleHistoryEntry[] {
  const entries: RoleHistoryEntry[] = [
    ...versions.map((version): RoleHistoryEntry =>
      version.version === 1
        ? { kind: "hired", at: version.savedAt }
        : {
            kind: "card-changed",
            at: version.savedAt,
            cardVersion: version.version,
            changes: version.changes,
          },
    ),
    ...skillChanges
      .filter(({ changedAt }) => changedAt >= hiredAt)
      .map(({ added, removed, changedAt }): RoleHistoryEntry => ({
        kind: "skills-changed",
        at: changedAt,
        added,
        removed,
      })),
  ];
  return entries.toSorted(
    (first, second) => second.at.getTime() - first.at.getTime() || rank(second) - rank(first),
  );
}

/** Among entries at one time: the hire, then the card, then its skills. */
function rank(entry: RoleHistoryEntry): number {
  return { hired: 0, "card-changed": 1, "skills-changed": 2 }[entry.kind];
}
