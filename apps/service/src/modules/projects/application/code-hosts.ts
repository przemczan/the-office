import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import { TestInstanceRefused } from "../domain/test-instance-refused.js";
import {
  CodeHost,
  CodeHostRefused,
  type OpenedPullRequest,
  type PullRequestRequest,
} from "../ports/code-host.js";

/**
 * Every code host The Office opens and reads pull requests on, each chosen by the remote's URL:
 * the first whose `reaches` holds it. GitHub's alone today; another host is one more adapter of
 * `CodeHost` given here in projects.module.ts.
 */
export class CodeHosts {
  constructor(
    private readonly hosts: readonly CodeHost[],
    private readonly testInstance: OfficeTestInstance = OfficeTestInstance.OFF,
  ) {}

  /** The hosts' names in the user's words, such as "GitHub", or "GitHub or GitLab". */
  get names(): string {
    return this.hosts.map((host) => host.name).join(" or ");
  }

  /** The host that holds the repository at `remoteUrl`; undefined when none of them does. */
  of(remoteUrl: string): CodeHost | undefined {
    return this.hosts.find((host) => host.reaches(remoteUrl));
  }

  /** Why no pull request can be opened on the remote, by its host's rules or as no host's. */
  whyCannotOpen(remoteUrl: string): Promise<string | undefined> {
    const host = this.of(remoteUrl);
    return host ? host.whyCannotOpen(remoteUrl) : Promise.resolve(this.notOnAnyHost());
  }

  /**
   * Opens the pull request on the remote's host; throws CodeHostRefused when there is none, and
   * TestInstanceRefused in a test instance of The Office.
   */
  open(request: PullRequestRequest): Promise<OpenedPullRequest> {
    if (this.testInstance.on) return Promise.reject(new TestInstanceRefused("open-pull-request"));
    const host = this.of(request.remoteUrl);
    if (!host) return Promise.reject(new CodeHostRefused(this.notOnAnyHost()));
    return host.open(request);
  }

  private notOnAnyHost(): string {
    const names = this.hosts.map((host) => host.name).join(", ");
    return `The remote isn't a repository on a code host The Office knows (${names}), so no pull request can be opened there.`;
  }
}
