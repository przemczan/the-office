import type { CiRunJobs, CiRunStatus } from "../domain/ci-run.js";
import type { ManualWorkflow } from "../domain/manual-workflow.js";
import type { MergeMethod } from "../domain/merge-method.js";
import type { PullRequestStatus } from "../domain/pull-request.js";

/** What a pull request asks: to merge `branch` into `baseBranch`, in the record's words. */
export interface PullRequestRequest {
  /** The URL of the remote the branch was pushed to, as git resolves it. */
  readonly remoteUrl: string;
  readonly baseBranch: string;
  readonly branch: string;
  readonly title: string;
  /** Markdown. */
  readonly body: string;
}

/** A pull request the code host holds, by its number in the repository and its web address. */
export interface OpenedPullRequest {
  readonly number: number;
  readonly url: string;
}

/** An open pull request as the code host lists it. */
export interface PullRequestOnHost extends OpenedPullRequest {
  readonly title: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly headCommit: string;
  readonly baseCommit: string;
}

/** A run of a workflow as the code host lists it, in words no host owns. */
export interface CiRunOnHost {
  readonly id: number;
  readonly number: number;
  readonly attempt: number;
  readonly workflow: string;
  readonly title: string;
  /** What started it, such as push or pull_request, as the host names it. */
  readonly trigger: string;
  readonly branch: string | null;
  readonly commit: string;
  readonly status: CiRunStatus;
  readonly startedAt: Date | null;
  readonly updatedAt: Date;
  /** Its logs on the host. */
  readonly url: string;
}

/** The merge methods a repository allows, and whether its host deletes a branch once merged. */
export interface MergeMethodsOnHost {
  /** In MERGE_METHODS' order; all three when the host doesn't say, leaving the choice to it. */
  readonly allowed: readonly MergeMethod[];
  /** Undefined when the host doesn't say. */
  readonly deletesBranchOnMerge: boolean | undefined;
}

export interface MergeRequest {
  readonly method: MergeMethod;
  /** The head commit The Office last read; the host refuses the merge when the branch moved since. */
  readonly expectedHeadCommit: string;
}

/** A pull request the host merged, by the commit the merge made on its base. */
export interface MergedOnHost {
  readonly commit: string;
}

/** The code host refused, or couldn't be asked; `message` says why for the user. */
export class CodeHostRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeHostRefused";
  }
}

/**
 * The host refused as the pull request changed since The Office last read it, such as its branch
 * moving past the expected head commit; reading it again and retrying may succeed.
 */
export class CodeHostChangedSince extends CodeHostRefused {
  constructor(message: string) {
    super(message);
    this.name = "CodeHostChangedSince";
  }
}

/**
 * A host that keeps Projects' pull requests, asked as the user signed in to it by Office code
 * only (spec §5.5 Defaults). `CodeHosts` picks the one for a remote by its URL (`reaches`). Throws
 * CodeHostRefused when it refuses or can't be reached.
 */
export abstract class CodeHost {
  /** The host's name in the user's words, such as GitHub. */
  abstract readonly name: string;

  /** Whether this host holds the repository at `remoteUrl`, without asking it. */
  abstract reaches(remoteUrl: string): boolean;

  /**
   * Why no pull request can be opened on the remote at `remoteUrl`, asked before the push so a
   * Publish that couldn't open one pushes nothing; undefined when one can be.
   */
  abstract whyCannotOpen(remoteUrl: string): Promise<string | undefined>;

  /** Opens the pull request, or finds the one already open for the branch. */
  abstract open(request: PullRequestRequest): Promise<OpenedPullRequest>;

  /**
   * Why the remote's pull requests can't be read now, such as no one signed in with a token valid
   * now, without asking the host; undefined when they can be. Never throws.
   */
  abstract whyCannotRead(remoteUrl: string): Promise<string | undefined>;

  /** Every open pull request of the repository at `remoteUrl`. */
  abstract openPullRequests(remoteUrl: string): Promise<readonly PullRequestOnHost[]>;

  /** Where pull request `number` of the repository stands now. */
  abstract pullRequestStatus(remoteUrl: string, number: number): Promise<PullRequestStatus>;

  /** The merge methods the repository allows for pull request `number`. */
  abstract mergeMethods(remoteUrl: string, number: number): Promise<MergeMethodsOnHost>;

  /** Merges pull request `number`; never deletes its branch. */
  abstract merge(remoteUrl: string, number: number, request: MergeRequest): Promise<MergedOnHost>;

  /** Closes pull request `number` without merging it; its branch stays. */
  abstract close(remoteUrl: string, number: number): Promise<void>;

  /** The repository's `count` most recent CI runs, newest first. */
  abstract recentRuns(remoteUrl: string, count: number): Promise<readonly CiRunOnHost[]>;

  /** Runs CI run `runId` again, with all its jobs or only the failed ones. */
  abstract rerun(remoteUrl: string, runId: number, jobs: CiRunJobs): Promise<void>;

  /** The repository's active Workflows whose file, at branch or tag `ref`, declares a start by hand. */
  abstract manualWorkflows(remoteUrl: string, ref: string): Promise<readonly ManualWorkflow[]>;

  /** The repository's branches and tags, by name. */
  abstract refs(remoteUrl: string): Promise<RefsOnHost>;

  /** Starts a Workflow by hand; the host refuses, such as for an input its file doesn't declare. */
  abstract startWorkflow(remoteUrl: string, start: WorkflowStartRequest): Promise<void>;

  /** The repository's open issues as `listing` asks, pull requests left out. */
  abstract openIssues(remoteUrl: string, listing: IssueListing): Promise<readonly IssueOnHost[]>;

  /**
   * Issue `number` with where it stands now; undefined when the host has no such issue, or it is
   * a pull request.
   */
  abstract issue(remoteUrl: string, number: number): Promise<FoundIssueOnHost | undefined>;

  /** Comments on issue `number`, in Markdown. */
  abstract commentOnIssue(remoteUrl: string, number: number, body: string): Promise<void>;

  /** Closes issue `number` as not planned; one already closed stays so. */
  abstract closeIssue(remoteUrl: string, number: number): Promise<void>;
}

/** Which open issues to list: with a label (any case), in the order they were opened, how many at most. */
export interface IssueListing {
  readonly label?: string | undefined;
  readonly order: "oldest-first" | "newest-first";
  readonly most: number;
}

/** An open issue as the code host lists it, in words no host owns. */
export interface IssueOnHost {
  readonly number: number;
  readonly title: string;
  /** Markdown; empty when it has none. */
  readonly body: string;
  readonly url: string;
  readonly author: { readonly login: string; readonly url: string };
  readonly labels: readonly string[];
  readonly openedAt: Date;
}

/** Where an issue stands on the code host. */
export type IssueStateOnHost =
  { readonly state: "open" } | { readonly state: "closed"; readonly closedAt: Date };

/** An issue read on its own, with where it stands. */
export interface FoundIssueOnHost extends IssueOnHost {
  readonly state: IssueStateOnHost;
}

/** The branches and tags of a repository, by name. */
export interface RefsOnHost {
  readonly branches: readonly string[];
  readonly tags: readonly string[];
}

/** A start by hand: the Workflow by its file name, the branch or tag, and the inputs as text. */
export interface WorkflowStartRequest {
  readonly workflowId: string;
  readonly ref: string;
  readonly inputs: Readonly<Record<string, string>>;
}
