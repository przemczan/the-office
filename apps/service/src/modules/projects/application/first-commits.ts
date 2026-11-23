import { Injectable } from "@nestjs/common";
import type { NewProject } from "../domain/project.js";
import { UNCHANGED_ENVIRONMENT } from "../domain/project-environment.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { CLONE_REMOTE, Git, GitCommandFailed } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";

/** The message of the first commit an empty repository gets as it is added (spec §5.5 Defaults). */
export const FIRST_COMMIT_MESSAGE = "Initial commit";

/**
 * Gives a repository with no commits yet its base branch as it is added as a Project (spec §2.1.1,
 * "Empty repositories"), so Tasks have a commit to start from and publish into.
 */
@Injectable()
export class FirstCommits {
  constructor(
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
    private readonly remotes: ProjectRemotes,
  ) {}

  /**
   * Makes the base branch at an empty first commit when the repository has no commits; a clone's is
   * pushed to the remote's base branch, never forced, and tracks it. A failed push takes the branch
   * back, so the repository is left empty, and refuses in git's words.
   */
  async makeWhenEmpty({ path, baseBranch, repositoryUrl }: NewProject): Promise<void> {
    if (await this.git.hasCommits(path)) return;
    const commit = await this.firstCommit(path, baseBranch);
    if (repositoryUrl === undefined) return;
    const upstream = { remote: CLONE_REMOTE, branch: baseBranch };
    try {
      // A new Project's environment is the service's own, as its commands' is.
      const variables = this.commands.variablesFor(UNCHANGED_ENVIRONMENT);
      await this.git.push(path, baseBranch, upstream, variables);
    } catch (error) {
      if (!(error instanceof GitCommandFailed)) throw error;
      await this.git.removeRef(path, `refs/heads/${baseBranch}`, commit);
      const lacking = await this.remotes.whyPushFailed(repositoryUrl);
      const words = lacking === undefined ? error.detail : `${lacking} ${error.detail}`;
      throw new ProjectRefused([
        `The first commit couldn't be pushed to ${repositoryUrl}: ${words}`,
      ]);
    }
    await this.git.setUpstream(path, baseBranch, upstream);
  }

  private async firstCommit(path: string, baseBranch: string): Promise<string> {
    try {
      return await this.git.makeFirstCommit(path, baseBranch, FIRST_COMMIT_MESSAGE);
    } catch (error) {
      if (!(error instanceof GitCommandFailed)) throw error;
      throw new ProjectRefused([`The first commit couldn't be made: ${error.detail}`]);
    }
  }
}
