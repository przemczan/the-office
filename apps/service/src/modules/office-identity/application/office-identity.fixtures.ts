import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { GitCredentialHelper } from "./git-credential-helper.js";
import { GITHUB_SITE, type GitHubSite } from "../../../platform/config/github-site.js";
import type { GitHubUserToken } from "../ports/github-user-token.js";
import { HostKeyScanner } from "../ports/host-key-scanner.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeGitHome } from "./office-git-home.js";
import { OfficeIdentity } from "./office-identity.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";

/** A scanner for tests that confirm no host. */
export class NoHostKeyScanner extends HostKeyScanner {
  scan(): Promise<never> {
    return Promise.reject(new Error("No host is scanned here."));
  }
}

/** GitHub's website, on an API where nothing listens, so a test that reaches GitHub's list unasked fails. */
const UNREACHABLE_GITHUB_API: GitHubSite = { ...GITHUB_SITE, apiUrl: "http://127.0.0.1:9" };

/**
 * Where tests that name no Office data directory share one: every command writes the git home
 * and its global config file there, the same each time, and only an ssh remote writes more.
 */
const SHARED_OFFICE_DATA = join(tmpdir(), "office-identity-tests");

/**
 * The Office identity on an Office data directory; a test of ssh remotes gives its own, and one
 * of GitHub over https gives the user token.
 */
export function officeIdentityForTests(
  officeData: string = SHARED_OFFICE_DATA,
  gitHubUserToken?: GitHubUserToken,
): OfficeIdentity {
  const folder = new IdentityFolder(new OfficeDataDirectory(officeData));
  return new OfficeIdentity(
    new OfficeSshKey(folder),
    new OfficeKnownHosts(folder, new NoHostKeyScanner(), gitHubUserToken ?? UNREACHABLE_GITHUB_API),
    new OfficeGitHome(folder),
    new GitCredentialHelper(folder),
    gitHubUserToken,
  );
}
