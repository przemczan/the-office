import { Injectable } from "@nestjs/common";
import { OfficeIdentity } from "../../../platform/git-identity/office-identity.js";
import type { RemoteNeeds } from "../../../platform/git-identity/remote-needs.js";
import type { Project } from "../domain/project.js";
import { Git, GitCommandFailed } from "../ports/git.js";

const SETTINGS = "Settings › Office identity";

/**
 * The remote a Project's base branch is fetched from, and which part of the Office identity it
 * needs (spec §5.5 Defaults): a path-added Project's remote too, which its user's own credentials
 * no longer reach.
 */
@Injectable()
export class ProjectRemotes {
  constructor(
    private readonly git: Git,
    private readonly identity: OfficeIdentity,
  ) {}

  /**
   * What the base branch's remote needs, or undefined when the base branch tracks no remote branch
   * or its folder isn't a repository git can read. An ssh host whose key isn't trusted becomes an
   * Unconfirmed host, so the Project page's line and Settings › Office identity agree.
   */
  async needsOf(project: Project): Promise<RemoteNeeds | undefined> {
    try {
      const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
      if (!upstream) return undefined;
      return await this.listedNeedsOf(await this.git.fetchUrlOf(project.path, upstream.remote));
    } catch (error) {
      if (error instanceof GitCommandFailed) return undefined;
      throw error;
    }
  }

  /** git's own words, after what the Office identity lacks for the remote when it lacks something. */
  async reasonOf(project: Project, failure: Error): Promise<string> {
    const problem = failure instanceof GitCommandFailed ? failure.detail : failure.message;
    const lacking = await this.whyFetchFailed(project);
    return lacking === undefined ? problem : `${lacking} ${problem}`;
  }

  /** What a failed fetch of the base branch may lack, in the user's words; undefined if nothing. */
  async whyFetchFailed(project: Project): Promise<string | undefined> {
    const needs = await this.needsOf(project);
    return needs && fetchFailureReason(needs);
  }

  /** What a failed clone of `url` may lack, in the user's words; undefined if nothing. */
  async whyCloneFailed(url: string): Promise<string | undefined> {
    return fetchFailureReason(await this.identity.needsOf(await this.git.reachedUrlOf(url)));
  }

  /** What a failed push to `url` may lack, in the user's words; undefined if nothing. */
  async whyPushFailed(url: string): Promise<string | undefined> {
    return pushFailureReason(await this.identity.needsOf(await this.git.reachedUrlOf(url)));
  }

  /**
   * Why `url` can't be reached at all yet: an ssh host without the Office ssh key or a trusted host
   * key. GitHub over https without the sign-in still reaches a public repository.
   */
  async whyUnreachable(url: string): Promise<string | undefined> {
    const needs = await this.listedNeedsOf(await this.git.reachedUrlOf(url));
    if (needs.kind !== "ssh" || needs.missing.length === 0) return undefined;
    return sshFailureReason(needs.host, needs.missing);
  }

  /** What `remote` needs, its ssh host listed as an Unconfirmed host while its key isn't trusted. */
  private async listedNeedsOf(remote: string): Promise<RemoteNeeds> {
    const needs = await this.identity.needsOf(remote);
    if (needs.kind === "ssh" && needs.missing.includes("host-key")) {
      await this.identity.addUnconfirmedHost(needs.host, needs.port);
    }
    return needs;
  }
}

/** Decided from what the identity has, not from git's words, which follow the Project's locale. */
function fetchFailureReason(needs: RemoteNeeds): string | undefined {
  switch (needs.kind) {
    case "github-https":
      return needs.missing.length > 0
        ? `GitHub over https takes Sign in with GitHub, in ${SETTINGS}, for a private repository.`
        : undefined;
    case "ssh":
      return sshFailureReason(needs.host, needs.missing);
    case "anonymous-https":
      return `${needs.host} is reached anonymously over https, so only a public repository can be fetched.`;
    case "refused":
      return `The Office reaches remotes over https and ssh only, not ${needs.scheme}.`;
    case "local":
      return undefined;
  }
}

/** A push needs more than a fetch: GitHub's sign-in even for a public repository. */
function pushFailureReason(needs: RemoteNeeds): string | undefined {
  switch (needs.kind) {
    case "github-https":
      return needs.missing.length > 0
        ? `Pushing to GitHub over https takes Sign in with GitHub, in ${SETTINGS}.`
        : undefined;
    case "anonymous-https":
      return `${needs.host} is reached anonymously over https, so The Office can't push there.`;
    case "ssh":
    case "refused":
    case "local":
      return fetchFailureReason(needs);
  }
}

function sshFailureReason(
  host: string,
  missing: Extract<RemoteNeeds, { kind: "ssh" }>["missing"],
): string {
  if (missing.includes("host-key")) {
    return `The Office doesn't trust ${host}'s host key yet: confirm its fingerprint in ${SETTINGS}.`;
  }
  return `${host} takes the Office ssh key once its public half, shown in ${SETTINGS}, is added there.`;
}
