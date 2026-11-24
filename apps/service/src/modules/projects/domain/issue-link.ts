import type { IssueUser } from "./issue-settings.js";

/** Who imported an issue as a Task: the user, by hand, or The Office's auto-import. */
export type IssueImportedBy =
  { readonly kind: "user"; readonly user: IssueUser } | { readonly kind: "office" };

/**
 * Why a Task imported from an issue was Dropped, as Work tells it: a Duplicate names the other
 * Task, by its id and title, whose own issue link Projects finds.
 */
export type IssueDropReason =
  | { readonly kind: "wont-fix" }
  | { readonly kind: "duplicate"; readonly taskId: string; readonly title: string }
  | { readonly kind: "cant-reproduce" }
  | { readonly kind: "other"; readonly text: string };

/** What a write-back does on the issue: comment on it, close it, or open it again. */
export const ISSUE_WRITE_BACK_ACTIONS = ["comment", "close", "reopen"] as const;
export type IssueWriteBackAction = (typeof ISSUE_WRITE_BACK_ACTIONS)[number];

/**
 * An issue imported as a Task, kept for good: import-once by its remote and number. Its Task is
 * null only while the import claims it, before the Task is made.
 */
export interface IssueLink {
  readonly id: string;
  readonly projectId: string;
  /** The repository, as git resolves the base branch's remote. */
  readonly remoteUrl: string;
  readonly number: number;
  readonly taskId: string | null;
  readonly title: string;
  readonly url: string;
  readonly author: { readonly login: string; readonly url: string };
  readonly importedAt: Date;
  readonly importedBy: IssueImportedBy;
  /** When the issue was closed on the code host, as last read; null while open. */
  readonly closedOnHostAt: Date | null;
  /** When the Task became Done or Dropped: the issue is watched no more. */
  readonly taskEndedAt: Date | null;
  readonly checkedAt: Date | null;
}

/** One comment or close to write on an issue, kept until the code host takes it. */
export interface IssueWriteBackEntry {
  readonly id: string;
  readonly issueLinkId: string;
  readonly action: IssueWriteBackAction;
  /** A comment's Markdown; empty for a close. */
  readonly body: string;
  readonly createdAt: Date;
  readonly doneAt: Date | null;
  readonly tries: number;
  readonly lastProblem: string | null;
}

/** The Kind an issue imports as: Bug when one of its labels is `bug`, in any case, else Feature. */
export function issueKindOf(labels: readonly string[]): "bug" | "feature" {
  return labels.some((label) => label.trim().toLowerCase() === "bug") ? "bug" : "feature";
}

/** The comment when the Task starts. */
export function startedComment(taskTitle: string): string {
  return `Work on this issue started in The Office: ${taskTitle}.`;
}

/** Where a Done Task landed: its pull request, the commit its merge made, or neither known. */
export type IssueDoneIn =
  | { readonly kind: "pull-request"; readonly number: number }
  | { readonly kind: "commit"; readonly commit: string }
  | { readonly kind: "unknown" };

/** The comment when the Task is Done: "Done in #12." or "Done in 3f2c1ab." */
export function doneComment(doneIn: IssueDoneIn): string {
  switch (doneIn.kind) {
    case "pull-request":
      return `Done in #${doneIn.number}.`;
    case "commit":
      return `Done in ${doneIn.commit.slice(0, 7)}.`;
    case "unknown":
      return "Done in The Office.";
  }
}

/**
 * The other Task a Duplicate names: its issue's number when it was imported from one in the same
 * repository, else its title.
 */
export type DuplicateOf =
  | { readonly kind: "issue"; readonly number: number }
  | { readonly kind: "task"; readonly title: string };

/** The comment giving why the Task was Dropped, before the issue is closed as not planned. */
export function droppedComment(
  reason: IssueDropReason | null,
  duplicateOf: DuplicateOf | undefined,
): string {
  switch (reason?.kind) {
    case undefined:
      return "Closed: the Task was dropped.";
    case "wont-fix":
      return "Closed: won't fix.";
    case "cant-reproduce":
      return "Closed: can't be reproduced.";
    case "other":
      return `Closed: ${reason.text}`;
    case "duplicate":
      return duplicateOf?.kind === "issue"
        ? `Closed as a duplicate of #${duplicateOf.number}.`
        : `Closed as a duplicate of another Task in The Office: ${duplicateOf?.title ?? reason.title}.`;
  }
}

/** The comment on an issue a Drop closed, as its Task is reopened and the issue with it. */
export const REOPENED_COMMENT = "Reopened: the Task was reopened.";
