import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import { ISSUES_FEATURE, PROJECT_FEATURE_REGISTRY } from "../domain/project-features.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { CodeHost } from "../ports/code-host.js";
import { Git } from "../ports/git.js";
import { CodeHosts } from "./code-hosts.js";

/** A Project's repository on its code host: the base branch's remote URL, and the host. */
export interface ProjectIssueHost {
  readonly remoteUrl: string;
  readonly host: CodeHost;
}

/**
 * Where a Project's issues are: the code host holding the remote its base branch tracks, by the
 * URL git resolves for it, which issue links keep as their repository.
 */
@Injectable()
export class ProjectIssueHosts {
  constructor(
    private readonly git: Git,
    private readonly codeHosts: CodeHosts,
  ) {}

  /** Undefined when the base branch tracks no remote, git fails, or no host holds it. */
  async of(project: Project): Promise<ProjectIssueHost | undefined> {
    const remoteUrl = await this.remoteUrlOf(project);
    const host = remoteUrl === undefined ? undefined : this.codeHosts.of(remoteUrl);
    return remoteUrl === undefined || host === undefined ? undefined : { remoteUrl, host };
  }

  /**
   * The name of the code host holding the Project's repository, such as GitHub; null when none
   * does. Read from git's config only, never from the host, so a Project list stays cheap.
   */
  async codeHostNameOf(project: Project): Promise<string | null> {
    return (await this.of(project))?.host.name ?? null;
  }

  /**
   * The Project's host, whose issues can be read now; refused, saying why, otherwise, in the words
   * of the issues' switch and of the code hosts.
   */
  async readable(project: Project): Promise<ProjectIssueHost> {
    const issues = PROJECT_FEATURE_REGISTRY[ISSUES_FEATURE].name;
    const remoteUrl = await this.remoteUrlOf(project);
    if (remoteUrl === undefined) {
      throw new ProjectRefused([
        `${project.name}'s base branch ${project.baseBranch} tracks no remote, so it has no ${issues}.`,
      ]);
    }
    const host = this.codeHosts.of(remoteUrl);
    if (host === undefined) {
      throw new ProjectRefused([
        `${issues} need a repository on ${this.codeHosts.names}. This Project's is at ${hostOf(remoteUrl)}.`,
      ]);
    }
    if ((await host.whyCannotRead(remoteUrl)) !== undefined) {
      throw new ProjectRefused([`${host.signInWords} to import issues.`]);
    }
    return { remoteUrl, host };
  }

  private async remoteUrlOf(project: Project): Promise<string | undefined> {
    try {
      const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
      return upstream && (await this.git.fetchUrlOf(project.path, upstream.remote));
    } catch {
      // A Project whose folder is gone or broken has no issues to read; its page says why.
      return undefined;
    }
  }
}

/** The host of a remote's URL, ssh's `git@host:path` included; the URL itself when it has none. */
function hostOf(remoteUrl: string): string {
  try {
    return new URL(remoteUrl).host || remoteUrl;
  } catch {
    return /^[^@]+@([^:]+):/.exec(remoteUrl)?.[1] ?? remoteUrl;
  }
}
