import type { PublishingMode } from "@the-office/contracts";

/** How Publish ships a Task's branch in a Project, wherever a Project or a Stage names it. */
export function publishingLabel(mode: PublishingMode, baseBranch: string): string {
  return mode === "merge" ? `Merge into ${baseBranch}` : "Push and open a pull request";
}
