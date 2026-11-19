import { Injectable } from "@nestjs/common";
import {
  GitHubAccessFailed,
  GitHubPullRequests,
  type DispatchInput,
  type DispatchInputType,
  type ManualWorkflowOnGitHub,
  NotSignedInWithGitHub,
  PullRequestChangedOnGitHub,
  PullRequestNotChanged,
  PullRequestNotOpened,
} from "../../../github/index.js";
import type { CiRunJobs } from "../../domain/ci-run.js";
import type {
  ManualWorkflow,
  WorkflowInput,
  WorkflowInputKind,
} from "../../domain/manual-workflow.js";
import type { PullRequestStatus } from "../../domain/pull-request.js";
import {
  CodeHost,
  CodeHostChangedSince,
  CodeHostRefused,
  type CiRunOnHost,
  type MergedOnHost,
  type MergeMethodsOnHost,
  type MergeRequest,
  type OpenedPullRequest,
  type PullRequestOnHost,
  type PullRequestRequest,
  type RefsOnHost,
  type WorkflowStartRequest,
} from "../../ports/code-host.js";

/**
 * GitHub as a code host: pull requests opened and read, Actions runs listed and re-run, and
 * workflows started by hand, by the github module through GitHub's REST API as the signed-in user. Its failures become
 * CodeHostRefused in the github module's words.
 */
@Injectable()
export class GitHubCodeHost extends CodeHost {
  readonly name = "GitHub";

  constructor(private readonly gitHub: GitHubPullRequests) {
    super();
  }

  reaches(remoteUrl: string): boolean {
    return this.gitHub.reaches(remoteUrl);
  }

  whyCannotOpen(remoteUrl: string): Promise<string | undefined> {
    return this.gitHub.whyCannotOpen(remoteUrl);
  }

  open({
    remoteUrl,
    baseBranch,
    branch,
    title,
    body,
  }: PullRequestRequest): Promise<OpenedPullRequest> {
    return refusing(this.gitHub.open({ remoteUrl, base: baseBranch, head: branch, title, body }));
  }

  whyCannotRead(remoteUrl: string): Promise<string | undefined> {
    return this.gitHub.whyCannotRead(remoteUrl);
  }

  openPullRequests(remoteUrl: string): Promise<readonly PullRequestOnHost[]> {
    return refusing(this.gitHub.openPullRequests(remoteUrl));
  }

  pullRequestStatus(remoteUrl: string, number: number): Promise<PullRequestStatus> {
    return refusing(this.gitHub.status(remoteUrl, number));
  }

  recentRuns(remoteUrl: string, count: number): Promise<readonly CiRunOnHost[]> {
    return refusing(this.gitHub.recentRuns(remoteUrl, count));
  }

  rerun(remoteUrl: string, runId: number, jobs: CiRunJobs): Promise<void> {
    return refusing(this.gitHub.rerun(remoteUrl, runId, jobs === "failed"));
  }

  async manualWorkflows(remoteUrl: string, ref: string): Promise<readonly ManualWorkflow[]> {
    return (await refusing(this.gitHub.manualWorkflows(remoteUrl, ref))).map(toManualWorkflow);
  }

  refs(remoteUrl: string): Promise<RefsOnHost> {
    return refusing(this.gitHub.refs(remoteUrl));
  }

  startWorkflow(
    remoteUrl: string,
    { workflowId, ref, inputs }: WorkflowStartRequest,
  ): Promise<void> {
    return refusing(this.gitHub.startWorkflow(remoteUrl, { file: workflowId, ref, inputs }));
  }

  mergeMethods(remoteUrl: string, _number: number): Promise<MergeMethodsOnHost> {
    // GitHub's merge methods are the repository's, the same for each of its pull requests.
    return refusing(this.gitHub.mergeMethods(remoteUrl));
  }

  merge(remoteUrl: string, number: number, request: MergeRequest): Promise<MergedOnHost> {
    return refusing(this.gitHub.merge(remoteUrl, number, request));
  }

  close(remoteUrl: string, number: number): Promise<void> {
    return refusing(this.gitHub.close(remoteUrl, number));
  }
}

const KINDS: Readonly<Record<DispatchInputType, WorkflowInputKind>> = {
  string: "text",
  boolean: "yes-no",
  choice: "choice",
  number: "number",
  environment: "environment",
};

function toManualWorkflow({ file, name, url, inputs }: ManualWorkflowOnGitHub): ManualWorkflow {
  return { id: file, name, url, inputs: inputs.map(toWorkflowInput) };
}

function toWorkflowInput({ type, ...input }: DispatchInput): WorkflowInput {
  return { ...input, kind: KINDS[type] };
}

/** The github module's refusals as the code host's; anything else is a fault and stays as it is. */
async function refusing<Answer>(asked: Promise<Answer>): Promise<Answer> {
  try {
    return await asked;
  } catch (error) {
    if (error instanceof PullRequestChangedOnGitHub) throw new CodeHostChangedSince(error.message);
    if (
      error instanceof PullRequestNotChanged ||
      error instanceof PullRequestNotOpened ||
      error instanceof NotSignedInWithGitHub ||
      error instanceof GitHubAccessFailed
    ) {
      throw new CodeHostRefused(error.message);
    }
    throw error;
  }
}
