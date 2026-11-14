import type { RoleSkillsChange } from "../../skills/index.js";
import type { RoleCardVersion } from "../domain/role.js";
import type { RoleCardFieldChange } from "../domain/role-card-changes.js";
import type { UserRef } from "../domain/user.js";

/**
 * One line of a person's change history: the hire, a card change or a change of skills, each with
 * the user who made it (null when no user did, or before users existed). A hire or card change the
 * user applied from a Proposal names who proposed it, by the key of their Role.
 */
export type RoleHistoryEntry =
  | {
      readonly kind: "hired";
      readonly at: Date;
      readonly proposedBy: string | undefined;
      readonly savedBy: UserRef | null;
    }
  | {
      readonly kind: "card-changed";
      readonly at: Date;
      readonly cardVersion: number;
      readonly changes: readonly RoleCardFieldChange[];
      readonly proposedBy: string | undefined;
      readonly savedBy: UserRef | null;
    }
  | {
      readonly kind: "skills-changed";
      readonly at: Date;
      readonly added: readonly string[];
      readonly removed: readonly string[];
      readonly changedBy: UserRef | null;
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
        ? {
            kind: "hired",
            at: version.savedAt,
            proposedBy: version.proposedBy,
            savedBy: version.savedBy,
          }
        : {
            kind: "card-changed",
            at: version.savedAt,
            cardVersion: version.version,
            changes: version.changes,
            proposedBy: version.proposedBy,
            savedBy: version.savedBy,
          },
    ),
    ...skillChanges
      .filter(({ changedAt }) => changedAt >= hiredAt)
      .map(({ added, removed, changedAt, changedBy }): RoleHistoryEntry => ({
        kind: "skills-changed",
        at: changedAt,
        added,
        removed,
        changedBy,
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
