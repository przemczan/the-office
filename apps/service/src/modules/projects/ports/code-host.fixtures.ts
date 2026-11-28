import type { PullRequestStatus } from "../domain/pull-request.js";
import type { ManualWorkflow } from "../domain/manual-workflow.js";
import {
  CodeHost,
  CodeHostRefused,
  type CiRunOnHost,
  type FoundIssueOnHost,
  type IssueListing,
  type IssueOnHost,
  type IssueStateOnHost,
  type MergedOnHost,
  type MergeMethodsOnHost,
  type OpenedPullRequest,
  type PullRequestOnHost,
  type RefsOnHost,
} from "./code-host.js";

/** An issue on `IssueHostForTests`, as a test names it; what it leaves out is defaulted. */
export interface IssueForTests {
  readonly number: number;
  readonly title?: string;
  readonly body?: string;
  readonly labels?: readonly string[];
  /** A fixed day in 2026 plus its number of minutes unless named. */
  readonly openedAt?: Date;
  readonly state?: IssueStateOnHost;
}

/**
 * A code host holding one repository's issues in memory, for the issue import, watch and
 * write-backs: no pull requests, CI runs or workflows. `signedOut` makes `whyCannotRead` say so;
 * `refusal` makes every comment and close refused in its words.
 */
export class IssueHostForTests extends CodeHost {
  readonly name = "GitHub";
  readonly signInWords = "Sign in with GitHub in Settings › Office identity";
  readonly issues = new Map<number, Required<IssueForTests>>();
  /** Every comment, close and reopen taken, in order. */
  readonly writes: {
    readonly action: "comment" | "close" | "reopen";
    readonly number: number;
    readonly body?: string;
  }[] = [];
  /** Every listing asked for, in order. */
  readonly listings: IssueListing[] = [];
  signedOut = false;
  refusal: string | undefined = undefined;

  constructor(readonly remoteUrl = "https://github.com/office/tools.git") {
    super();
  }

  addIssue(issue: IssueForTests): void {
    this.issues.set(issue.number, {
      title: `Issue ${issue.number}`,
      body: "",
      labels: [],
      openedAt: new Date(Date.parse("2026-01-05T09:00:00Z") + issue.number * 60_000),
      state: { state: "open" },
      ...issue,
    });
  }

  /** Closes the issue on the host, as someone on GitHub would. */
  closeOnHost(number: number, at = new Date("2026-11-19T12:00:00Z")): void {
    const issue = this.issues.get(number);
    if (issue) this.issues.set(number, { ...issue, state: { state: "closed", closedAt: at } });
  }

  reaches(remoteUrl: string): boolean {
    return remoteUrl === this.remoteUrl;
  }

  whyCannotOpen(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  whyCannotRead(): Promise<string | undefined> {
    return Promise.resolve(this.signedOut ? "No one is signed in with GitHub." : undefined);
  }

  async openIssues(_remoteUrl: string, listing: IssueListing): Promise<readonly IssueOnHost[]> {
    this.listings.push(listing);
    const label = listing.label?.toLowerCase();
    return [...this.issues.values()]
      .filter((issue) => issue.state.state === "open")
      .filter(
        (issue) => label === undefined || issue.labels.some((each) => each.toLowerCase() === label),
      )
      .toSorted(
        (one, other) =>
          (one.openedAt.getTime() - other.openedAt.getTime()) *
          (listing.order === "oldest-first" ? 1 : -1),
      )
      .slice(0, listing.most)
      .map((issue) => this.onHost(issue));
  }

  async issue(_remoteUrl: string, number: number): Promise<FoundIssueOnHost | undefined> {
    const issue = this.issues.get(number);
    return issue && { ...this.onHost(issue), state: issue.state };
  }

  async commentOnIssue(_remoteUrl: string, number: number, body: string): Promise<void> {
    if (this.refusal !== undefined) throw new CodeHostRefused(this.refusal);
    this.writes.push({ action: "comment", number, body });
  }

  async closeIssue(_remoteUrl: string, number: number): Promise<void> {
    if (this.refusal !== undefined) throw new CodeHostRefused(this.refusal);
    this.writes.push({ action: "close", number });
    this.closeOnHost(number);
  }

  async reopenIssue(_remoteUrl: string, number: number): Promise<void> {
    if (this.refusal !== undefined) throw new CodeHostRefused(this.refusal);
    this.writes.push({ action: "reopen", number });
    const issue = this.issues.get(number);
    if (issue) this.issues.set(number, { ...issue, state: { state: "open" } });
  }

  open(): Promise<OpenedPullRequest> {
    return Promise.reject(new CodeHostRefused("No pull requests here."));
  }

  openPullRequests(): Promise<readonly PullRequestOnHost[]> {
    return Promise.resolve([]);
  }

  pullRequestStatus(): Promise<PullRequestStatus> {
    return Promise.reject(new CodeHostRefused("No pull requests here."));
  }

  mergeMethods(): Promise<MergeMethodsOnHost> {
    return Promise.reject(new CodeHostRefused("No pull requests here."));
  }

  merge(): Promise<MergedOnHost> {
    return Promise.reject(new CodeHostRefused("No pull requests here."));
  }

  close(): Promise<void> {
    return Promise.reject(new CodeHostRefused("No pull requests here."));
  }

  recentRuns(): Promise<readonly CiRunOnHost[]> {
    return Promise.resolve([]);
  }

  rerun(): Promise<void> {
    return Promise.reject(new CodeHostRefused("No CI here."));
  }

  manualWorkflows(): Promise<readonly ManualWorkflow[]> {
    return Promise.resolve([]);
  }

  refs(): Promise<RefsOnHost> {
    return Promise.resolve({ branches: [], tags: [] });
  }

  startWorkflow(): Promise<void> {
    return Promise.reject(new CodeHostRefused("No workflows here."));
  }

  runsStartedByHand(): Promise<readonly CiRunOnHost[]> {
    return Promise.resolve([]);
  }

  ciRun(): Promise<CiRunOnHost | undefined> {
    return Promise.resolve(undefined);
  }

  workflowRunsUrl(): string | undefined {
    return undefined;
  }

  private onHost({ number, title, body, labels, openedAt }: Required<IssueForTests>): IssueOnHost {
    return {
      number,
      title,
      body,
      url: `https://github.com/office/tools/issues/${number}`,
      author: { login: "octocat", url: "https://github.com/octocat" },
      labels,
      openedAt,
    };
  }
}
