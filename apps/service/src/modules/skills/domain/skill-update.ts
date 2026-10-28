import { pinnedVersionLabel, samePinnedVersion, type PinnedVersion } from "./installed-source.js";
import type { Skill } from "./skill.js";

/** An update as it was proposed: from the pinned version the skill had to the Source's newer one. */
export interface ProposedUpdate {
  readonly name: string;
  readonly from: PinnedVersion;
  readonly to: PinnedVersion;
}

/** What an update changes in the skill's files, as git shows it between the two pinned versions. */
export interface SkillUpdateDiff {
  readonly from: PinnedVersion;
  readonly to: PinnedVersion;
  /** The unified diff of the skill's folder, its paths inside the folder. */
  readonly diff: string;
  /** The diff stops at a whole line before `UPDATE_DIFF_BYTES`. */
  readonly diffCut: boolean;
}

/** As much diff as a card or Devops reads at once. */
export const UPDATE_DIFF_BYTES = 200 * 1024;

/** The diff up to the last whole line within `limitBytes`, and whether it was cut. */
export function cutDiff(
  diff: string,
  limitBytes: number,
): Pick<SkillUpdateDiff, "diff" | "diffCut"> {
  const bytes = new TextEncoder().encode(diff);
  if (bytes.length <= limitBytes) return { diff, diffCut: false };
  const head = new TextDecoder().decode(bytes.subarray(0, limitBytes));
  return { diff: head.slice(0, head.lastIndexOf("\n") + 1), diffCut: true };
}

/**
 * Why the update can't be applied to the skill as it is now, in the UI's words; undefined when it
 * can. An update is stale once the skill moved off the version it was proposed from.
 */
export function updateProblem(skill: Skill, update: ProposedUpdate): string | undefined {
  const pinned = skill.installedFrom?.pinnedVersion;
  if (!pinned) return noUpdates(skill.name);
  if (!samePinnedVersion(pinned, update.from)) {
    return `${skill.name} is pinned at ${pinnedVersionLabel(pinned)} now, not at ${pinnedVersionLabel(update.from)} as this update was proposed from.`;
  }
  return undefined;
}

export function noUpdates(name: string): string {
  return `${name} wasn't installed from a source, so it has no updates.`;
}
