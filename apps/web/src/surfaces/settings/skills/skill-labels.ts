import type { Role, Skill, SkillSource, SkillState } from "@the-office/contracts";
import type { BadgeProps } from "@the-office/ui";
import { pinnedVersionLabel, sourceLabel } from "../../../shell/skill-words.ts";

const SOURCE_LABELS: Readonly<Record<SkillSource, string>> = {
  written: "Written in The Office",
  "uploaded-file": "Uploaded · one file",
  "uploaded-folder": "Uploaded · folder",
  installed: "Installed from a source",
};

/** How the skill came into the library: an installed one names its Source. */
export function skillSourceLabel(skill: Skill): string {
  return skill.installedFrom
    ? `Installed from ${sourceLabel(skill.installedFrom)}`
    : SOURCE_LABELS[skill.source];
}

/** The skill's version, and the pinned version an installed one is held at. */
export function skillVersionLabel(skill: Skill): string {
  return skill.installedFrom
    ? `v${skill.version} · pinned at ${pinnedVersionLabel(skill.installedFrom.pinnedVersion)}`
    : `v${skill.version}`;
}

export const STATE_BADGES: Readonly<
  Record<SkillState, { readonly label: string; readonly tone: NonNullable<BadgeProps["tone"]> }>
> = {
  "waiting-for-review": { label: "Off · waiting for your review", tone: "warning" },
  off: { label: "Off", tone: "neutral" },
  on: { label: "On", tone: "success" },
};

/** Who has the skill: everyone, or the people whose Role it is assigned to, by first name. */
export function holdersLabel(skill: Skill, roles: readonly Role[]): string {
  if (skill.everyone) return "Everyone";
  const names = roles
    .filter((role) => skill.roles.includes(role.key))
    .map((role) => role.card.name);
  return names.length > 0 ? names.join(", ") : "Nobody";
}

/** The banner over the library, or undefined when nothing waits on the user. */
export function waitingLine(skills: readonly Skill[]): string | undefined {
  const waiting = skills.filter((skill) => skill.state === "waiting-for-review").length;
  if (waiting === 0) return undefined;
  return waiting === 1
    ? "1 skill waits for your review before anyone can use it."
    : `${waiting} skills wait for your review before anyone can use them.`;
}

/** What waits on the user comes first, then the library in the order it was filled. */
export function inReviewOrder(skills: readonly Skill[]): Skill[] {
  return skills.toSorted((first, second) => reviewRank(first) - reviewRank(second));
}

function reviewRank(skill: Skill): number {
  return skill.state === "waiting-for-review" ? 0 : 1;
}
