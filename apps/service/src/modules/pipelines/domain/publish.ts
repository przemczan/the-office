import { unmetStatements } from "./pipeline-walk.js";
import type { Stage } from "./stage.js";
import type { PublishedWork, StageOutcome, StageRun } from "./stage-run.js";
import { latestTestResults, type TestResult } from "./test-results.js";
import { acceptedIssues } from "./walk-decisions.js";

const SHORT_COMMIT_LENGTH = 8;

/** What a pull request opens with: the Task's title and its record. */
export interface PullRequestText {
  readonly title: string;
  /** Markdown. */
  readonly body: string;
}

/** A branch on a remote. */
export interface RemoteBranch {
  readonly remote: string;
  readonly branch: string;
}

/**
 * How Resolve's merge began (spec §2.3, "Conflicts at Publish"): the fetched base merged into the
 * Task's branch with the conflicted files left in the worktree for the Agent; merged cleanly, as
 * the base moved on past the conflict; or a failure, such as a fetch git refused.
 */
export type ResolveStart =
  | {
      readonly kind: "conflicted";
      /** The base whose merge conflicted: the Task's Initiative's branch or the base branch. */
      readonly base: RemoteBranch;
      readonly conflictedFiles: readonly string[];
      /** Where a clean merge of an earlier base left HEAD before the conflict. */
      readonly commit?: string;
    }
  | { readonly kind: "merged"; readonly base: RemoteBranch; readonly commit: string }
  | { readonly kind: "failed"; readonly error: string };

/**
 * How Resolve's merge ended: committed as one merge commit, or not, as files still hold conflict
 * markers, or a failure, such as no merge in progress to commit.
 */
export type ResolveEnd =
  | { readonly kind: "resolved"; readonly commit: string }
  | { readonly kind: "markers-left"; readonly files: readonly string[] }
  | { readonly kind: "failed"; readonly error: string };

/** How Publish took in a base that had moved on since the branch left it, if it had. */
export type BaseTakenIn = "not-needed" | "by-rebase" | "by-merge";

/**
 * How a Publish ended (spec §2.3, §9): the Task's branch pushed with a pull request open, or
 * merged into the base branch on its remote; pushed as a branch only, for a proof of concept;
 * nothing to publish; the base moved on so the branch
 * no longer applies cleanly, which asks the user; or a failure, such as a refused push, in words
 * for the Agent who repairs it or the user.
 */
export type Publication =
  | { readonly kind: "pull-request-opened"; readonly branch: string; readonly url: string }
  | {
      readonly kind: "merged";
      readonly branch: string;
      readonly into: RemoteBranch;
      readonly commit: string;
      /**
       * How The Office took in a base that had moved on: rebasing the branch onto it, or merging
       * it into a branch Resolve merged before, which a rebase would undo.
       */
      readonly baseTakenIn: BaseTakenIn;
      /** For a Task of an Initiative's branch, the bases that had moved on, in the order taken in. */
      readonly basesTakenIn?: readonly string[];
    }
  | { readonly kind: "branch-pushed"; readonly branch: string; readonly remote: string }
  | { readonly kind: "nothing-to-publish"; readonly branch: string; readonly base: RemoteBranch }
  | {
      readonly kind: "base-moved";
      readonly error: string;
      /** The files it would conflict in. */
      readonly conflictedFiles: readonly string[];
      /** Where a clean take-in of an earlier base, the Initiative's branch, left the branch. */
      readonly commit?: string;
    }
  | { readonly kind: "failed"; readonly error: string };

/** What a pull request tells of its Task: its title and its Definition of Done. */
export interface PublishedTask {
  readonly title: string;
  readonly definitionOfDone: readonly string[];
}

/**
 * The pull request's title and body from the Task's record (research §11.7): the Definition of
 * Done, each statement ticked when it is reported met; the latest result of each Stage before
 * Publish; and the issues the user chose to continue with.
 */
export function pullRequestText(
  task: PublishedTask,
  stages: readonly Stage[],
  runs: readonly StageRun[],
  publishKey: string,
): PullRequestText {
  const unmet = new Set(unmetStatements(task.definitionOfDone, runs));
  const statements = task.definitionOfDone.map(
    (statement) => `- [${unmet.has(statement) ? " " : "x"}] ${statement}`,
  );
  const before = stages.slice(
    0,
    stages.findIndex(({ key }) => key === publishKey),
  );
  const results = stageResults(before, runs);
  const accepted = acceptedIssues(stages, runs).map(
    ({ stageName, error }) => `- ${stageName}: ${firstLine(error)}`,
  );
  const sections = [
    `## Definition of Done\n\n${statements.join("\n")}`,
    results.length === 0 ? undefined : `## Stage results\n\n${results.join("\n\n")}`,
    accepted.length === 0 ? undefined : `## Issues the user accepted\n\n${accepted.join("\n")}`,
  ];
  return {
    title: task.title,
    body: sections.filter((section) => section !== undefined).join("\n\n"),
  };
}

function mergedWords({
  branch,
  into,
  baseTakenIn,
  basesTakenIn,
}: Extract<Publication, { kind: "merged" }>): string {
  switch (baseTakenIn) {
    case "not-needed":
      return `Merged ${branch}`;
    case "by-rebase":
      return `Rebased ${branch} onto ${into.branch}, which had moved on, then merged it`;
    case "by-merge":
      return `Merged ${(basesTakenIn ?? [into.branch]).join(" and ")}, which had moved on, into ${branch}, then merged it`;
  }
}

/** How the Publish Stage's run ended, from what Publish did. */
export function publishOutcome(publication: Publication): StageOutcome {
  switch (publication.kind) {
    case "pull-request-opened":
      return {
        status: "done",
        summary: `Pushed ${publication.branch} and opened the pull request ${publication.url}`,
        pullRequestUrl: publication.url,
      };
    case "merged": {
      const { into, commit } = publication;
      return {
        status: "done",
        summary: `${mergedWords(publication)} into ${into.branch} on ${into.remote}, which is now at ${commit.slice(0, SHORT_COMMIT_LENGTH)}.`,
      };
    }
    case "branch-pushed":
      return {
        status: "done",
        summary: `Pushed ${publication.branch} to ${publication.remote}, with no pull request and no merge, as this Publish pushes the branch only.`,
      };
    case "nothing-to-publish":
      return {
        status: "done",
        summary: `${publication.branch} adds nothing to ${publication.base.branch} on ${publication.base.remote}, so there was nothing to publish.`,
      };
    case "base-moved":
      return {
        status: "failed",
        error: publication.error,
        baseMoved: { conflictedFiles: publication.conflictedFiles },
      };
    case "failed":
      return { status: "failed", error: publication.error };
  }
}

/**
 * What a Publish shipped by the publishing mode (spec §2.3 Defaults): a pull request opened, or a
 * merge, with the commit that shipped, the merged one after a merge and `head` for a pull request.
 * Undefined for everything else, which runs no after publishing line.
 */
export function shippedWork(publication: Publication, head: string): PublishedWork | undefined {
  switch (publication.kind) {
    case "pull-request-opened":
      return {
        kind: publication.kind,
        branch: publication.branch,
        commit: head,
        pullRequestUrl: publication.url,
      };
    case "merged":
      return { kind: publication.kind, branch: publication.branch, commit: publication.commit };
    default:
      return undefined;
  }
}

/**
 * The variables the after publishing line runs with, beside the Project's own: what shipped, and
 * by which publishing mode.
 */
export function publishedVariables(published: PublishedWork): Record<string, string> {
  return {
    OFFICE_PUBLISHED_BRANCH: published.branch,
    OFFICE_PUBLISHED_COMMIT: published.commit,
    ...(published.pullRequestUrl !== undefined && {
      OFFICE_PULL_REQUEST_URL: published.pullRequestUrl,
    }),
    OFFICE_PUBLISHING_MODE: published.kind === "merged" ? "merge" : "push-and-pull-request",
  };
}

/**
 * A publication an earlier run of the Publish Stage shipped whose after publishing line hasn't
 * passed yet: the run again runs only that line, or, once the user chose Continue, ends done.
 */
export interface UnfinishedPublication {
  readonly published: PublishedWork;
  /** Why the latest run failed, when it did. */
  readonly error: string | undefined;
  /** Whether the user, or the Consultant asked first, chose Continue on the latest run's failure. */
  readonly continued: boolean;
}

/**
 * The publication kept on an earlier run of the Stage `stageKey` with no done run of it since, so
 * a retry never publishes again (the CTO's review of 2026-11-13).
 */
export function unfinishedPublication(
  stageKey: string,
  earlierRuns: readonly StageRun[],
): UnfinishedPublication | undefined {
  const runs = earlierRuns.filter((run) => run.stageKey === stageKey);
  const index = runs.findLastIndex(({ published }) => published !== undefined);
  const published = runs[index]?.published;
  if (published === undefined) return undefined;
  const since = runs.slice(index);
  if (since.some(({ outcome }) => outcome?.status === "done")) return undefined;
  const latest = since.at(-1);
  return {
    published,
    error: latest?.outcome?.status === "failed" ? latest.outcome.error : undefined,
    continued:
      latest?.decisions.some(
        ({ kind, answer }) =>
          kind === "after-publishing-failed" && answer?.kind === "accept-issues",
      ) ?? false,
  };
}

/** What shipped, in words for the Publish Stage's outcome. */
export function publishedSummary(published: PublishedWork): string {
  return published.kind === "merged"
    ? `Merged ${published.branch}, which shipped at ${published.commit.slice(0, SHORT_COMMIT_LENGTH)}.`
    : `Pushed ${published.branch} and opened the pull request ${published.pullRequestUrl ?? ""}`;
}

/** The after publishing line failed after the work shipped: its own outcome, never looped. */
export function afterPublishingFailedOutcome(
  published: PublishedWork,
  lineError: string,
): StageOutcome {
  return {
    status: "failed",
    error: `Published; after publishing failed: ${lineError}`,
    afterPublishingFailed: published,
  };
}

/**
 * What shipped, as the Stage's done outcome: in the run's own words of what it published,
 * `summary`, or for a retry in words of what shipped before, saying so when the after publishing
 * line ran and passed.
 */
export function shippedOutcome(
  published: PublishedWork,
  {
    summary = publishedSummary(published),
    afterLineRan,
  }: { readonly summary?: string | undefined; readonly afterLineRan: boolean },
): StageOutcome {
  return {
    status: "done",
    summary: afterLineRan ? `${summary}\n\nThe after publishing line passed.` : summary,
    ...(published.pullRequestUrl !== undefined && { pullRequestUrl: published.pullRequestUrl }),
  };
}

/** The user chose Continue after the after publishing line failed: done, with the failure noted. */
export function continuedOutcome({ published, error }: UnfinishedPublication): StageOutcome {
  return {
    status: "done",
    summary: `${error ?? `${publishedSummary(published)} The after publishing line didn't pass.`}\n\nThe Task went on with this failure noted.`,
    ...(published.pullRequestUrl !== undefined && { pullRequestUrl: published.pullRequestUrl }),
  };
}

/** Each Stage's latest result that tells of the work, under its name; a Stage yet to run has none. */
function stageResults(stages: readonly Stage[], runs: readonly StageRun[]): string[] {
  const testResults = latestTestResults(stages, runs);
  return stages.flatMap((stage) => {
    const result =
      stage.kind === "script"
        ? testResultText(testResults.find(({ stageKey }) => stageKey === stage.key))
        : stage.kind === "gate"
          ? gateResultText(stage, runs)
          : agentResultText(stage, runs);
    return result === undefined ? [] : [`### ${stage.name}\n\n${result}`];
  });
}

function testResultText(result: TestResult | undefined): string | undefined {
  switch (result?.state) {
    case undefined:
    case "not-run":
      return undefined;
    case "skipped":
      return "Skipped, as the Definition of Done was already met.";
    case "passed":
      return result.detail;
    case "failed":
      return `Failed: ${result.detail ?? ""}`;
  }
}

function gateResultText(stage: Stage, runs: readonly StageRun[]): string | undefined {
  const action = runs.findLast(({ stageKey }) => stageKey === stage.key)?.gateAction;
  return action?.kind === "continue"
    ? "The user looked at the work and let it continue."
    : undefined;
}

/** The latest run that ended by itself: a held or restarted run tells nothing of the work. */
function agentResultText(stage: Stage, runs: readonly StageRun[]): string | undefined {
  const outcome = runs.findLast(
    ({ stageKey, outcome: ended }) => stageKey === stage.key && endedByItself(ended),
  )?.outcome;
  switch (outcome?.status) {
    case "done":
      return outcome.skipped
        ? "Skipped, as the Definition of Done was already met."
        : outcome.summary.trim();
    case "failed":
      return `Failed: ${firstLine(outcome.error)}`;
    default:
      return undefined;
  }
}

function endedByItself(outcome: StageOutcome | undefined): boolean {
  return outcome?.status === "done" || (outcome?.status === "failed" && !outcome.interrupted);
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0]?.trim() ?? "";
}
