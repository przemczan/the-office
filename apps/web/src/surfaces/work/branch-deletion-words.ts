import type { BranchWork } from "@the-office/contracts";

/** How many of the lost commits' subjects the Delete branch window names. */
export const SHOWN_SUBJECTS = 5;

/** The warning over what a branch holds that its base lacks. */
export function commitsLostWords(commitCount: number, baseBranch: string): string {
  const commits = commitCount === 1 ? "1 commit" : `${commitCount} commits`;
  return `It holds ${commits} ${baseBranch} doesn't have; they are lost once it's deleted:`;
}

/** "and <m> more" under the subjects shown, when there are more commits than subjects shown. */
export function moreSubjectsWords(work: BranchWork): string | undefined {
  const shown = Math.min(work.subjects.length, SHOWN_SUBJECTS);
  const more = work.commitCount - shown;
  return more > 0 ? `and ${more} more` : undefined;
}
