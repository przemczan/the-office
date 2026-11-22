import type { BadgeProps } from "@the-office/ui";
import type { OfficeUpdateTarget, WaitingForYouItem } from "@the-office/contracts";

type WaitingForYouKind = WaitingForYouItem["kind"];
type PullRequestItem = Extract<WaitingForYouItem, { kind: "pull-request" }>;

/** The kind each Waiting for you card names on its badge. */
export const WAITING_FOR_YOU_KIND_NAMES: Readonly<Record<WaitingForYouKind, string>> = {
  proposal: "Proposal",
  "pull-request": "Pull request",
  "skill-updates": "Skill updates",
  "office-update": "Office update",
  "shaping-reply": "Shaping reply",
};

export const WAITING_FOR_YOU_KIND_TONES: Readonly<
  Record<WaitingForYouKind, NonNullable<BadgeProps["tone"]>>
> = {
  proposal: "accent",
  "pull-request": "warning",
  "skill-updates": "info",
  "office-update": "info",
  "shaping-reply": "info",
};

/** "Checks failing · Conflicts", what holds the pull request up. */
export function pullRequestTroubleWords({
  checksFailing,
  conflicts,
}: Pick<PullRequestItem, "checksFailing" | "conflicts">): string {
  return [checksFailing && "Checks failing", conflicts && "Conflicts"]
    .filter((words) => words !== false)
    .join(" · ");
}

/** "1 Skill has an update", "3 Skills have updates". */
export function skillUpdatesWords(count: number): string {
  return count === 1 ? "1 Skill has an update" : `${count} Skills have updates`;
}

/** "Version 1.4.0 is available", "Commit a1b2c3d is available". */
export function officeUpdateWords(target: OfficeUpdateTarget): string {
  return target.kind === "release"
    ? `Version ${target.version} is available`
    : `Commit ${target.shortCommit} is available`;
}
