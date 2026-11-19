import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { SignedInUser } from "../../../platform/http/signed-in-requests.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { recommendedMergeMethod, type MergeMethod } from "../domain/merge-method.js";
import type { PullRequest } from "../domain/pull-request.js";
import {
  PullRequestClosed,
  PullRequestMerged,
  type PullRequestEndedBy,
} from "../domain/pull-request-events.js";
import { PullRequestNotFound, PullRequestRefused } from "../domain/pull-request-refused.js";
import { CodeHost, CodeHostChangedSince, CodeHostRefused } from "../ports/code-host.js";
import { PullRequestRepository } from "../ports/pull-request-repository.js";
import { CodeHosts } from "./code-hosts.js";

/** What the Merge dialog offers: the methods the host allows, the one picked first and why. */
export interface MergeMethodsOffer {
  readonly allowed: readonly MergeMethod[];
  readonly recommended: MergeMethod;
  readonly warning: string | undefined;
  readonly deletesBranchOnMerge: boolean | undefined;
}

const METHOD_WORDS: Record<MergeMethod, string> = {
  merge: "a merge commit",
  squash: "squashing",
  rebase: "rebasing",
};

/**
 * Merges or closes a pull request The Office opened, from Work › Pull requests, on its code host
 * as the user signed in to it. The row ends by the repository's conditional `end`, as the watch's
 * does, so the merge or close is announced once whoever saw it first. The Office never deletes a
 * branch: what the host does on a merge is its own setting.
 */
@Injectable()
export class PullRequestActions {
  constructor(
    private readonly pullRequests: PullRequestRepository,
    private readonly codeHosts: CodeHosts,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

  /** The merge methods the repository allows for the pull request, and the one to pick first. */
  async mergeMethods(id: string): Promise<MergeMethodsOffer> {
    const pullRequest = await this.openOne(id);
    const host = this.hostOf(pullRequest);
    const { allowed, deletesBranchOnMerge } = await asked(() =>
      host.mergeMethods(pullRequest.remoteUrl, pullRequest.number),
    );
    const { recommended, warning } = recommendedMergeMethod(pullRequest.branch, allowed);
    if (recommended === undefined) {
      throw new PullRequestRefused(
        `${host.name} allows no merge method for pull request #${pullRequest.number}.`,
        false,
      );
    }
    return { allowed, recommended, warning, deletesBranchOnMerge };
  }

  /**
   * Merges the pull request by `method` at the head commit The Office last read: the host refuses
   * when the branch moved since, which is refused with `refresh`.
   */
  async merge(id: string, method: MergeMethod, by: SignedInUser): Promise<void> {
    const pullRequest = await this.openOne(id);
    const host = this.hostOf(pullRequest);
    const expectedHeadCommit = pullRequest.headCommit;
    if (expectedHeadCommit === null) {
      throw new PullRequestRefused(
        `The Office hasn't read pull request #${pullRequest.number} from ${host.name} yet. Refresh, then merge it.`,
        true,
      );
    }
    const { allowed } = await asked(() =>
      host.mergeMethods(pullRequest.remoteUrl, pullRequest.number),
    );
    if (!allowed.includes(method)) {
      throw new PullRequestRefused(
        `The repository doesn't allow merging by ${METHOD_WORDS[method]}; it allows ${allowed.map((one) => METHOD_WORDS[one]).join(", ") || "none"}.`,
        false,
      );
    }
    await asked(() =>
      host.merge(pullRequest.remoteUrl, pullRequest.number, { method, expectedHeadCommit }),
    );
    const at = this.schedule.now();
    const ended = await this.pullRequests.end(id, "merged", at);
    if (ended) {
      await this.events.publish(
        new PullRequestMerged(
          ended.id,
          ended.projectId,
          ended.taskId,
          ended.number,
          ended.url,
          method,
          endedBy(by),
          at,
        ),
      );
    }
  }

  /** Closes the pull request without merging it; its branch stays. */
  async close(id: string, by: SignedInUser): Promise<void> {
    const pullRequest = await this.openOne(id);
    const host = this.hostOf(pullRequest);
    await asked(() => host.close(pullRequest.remoteUrl, pullRequest.number));
    const at = this.schedule.now();
    const ended = await this.pullRequests.end(id, "closed", at);
    if (ended) {
      await this.events.publish(
        new PullRequestClosed(
          ended.id,
          ended.projectId,
          ended.taskId,
          ended.number,
          ended.url,
          endedBy(by),
          at,
        ),
      );
    }
  }

  /** The pull request kept by `id` while it is open; refused once it ended. */
  private async openOne(id: string): Promise<PullRequest> {
    const pullRequest = await this.pullRequests.findById(id);
    if (!pullRequest) throw new PullRequestNotFound(id);
    if (pullRequest.endedAt !== null) {
      throw new PullRequestRefused(
        `Pull request #${pullRequest.number} is already ${pullRequest.state === "merged" ? "merged" : "closed"}.`,
        true,
      );
    }
    return pullRequest;
  }

  private hostOf(pullRequest: PullRequest): CodeHost {
    const host = this.codeHosts.of(pullRequest.remoteUrl);
    if (!host) {
      throw new PullRequestRefused(
        `Pull request #${pullRequest.number}'s remote isn't on a code host The Office knows.`,
        false,
      );
    }
    return host;
  }
}

/** Asks the code host, turning its refusal into the pull request's, with `refresh` when it moved. */
async function asked<T>(ask: () => Promise<T>): Promise<T> {
  try {
    return await ask();
  } catch (error) {
    if (!(error instanceof CodeHostRefused)) throw error;
    throw new PullRequestRefused(error.message, error instanceof CodeHostChangedSince);
  }
}

function endedBy({ userId, name }: SignedInUser): PullRequestEndedBy {
  return { kind: "user", userId, name };
}
