import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { GitCredentialHelper } from "./git-credential-helper.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeGitHome } from "./office-git-home.js";
import { NoHostKeyScanner, officeIdentityForTests } from "./office-identity.fixtures.js";
import { OfficeIdentity, type GitCommandIdentity } from "./office-identity.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";
import { startTokenGitServer, type TokenGitServer } from "./token-git-server.fixtures.js";
import { userCredentials, type UserCredentials } from "./user-credentials.fixtures.js";
import {
  TOKEN,
  TestUserToken,
  bareRepositoryWithOneCommit,
  basic,
  gitCommand,
} from "./office-identity-github.fixtures.js";

describe("OfficeIdentity, GitHub over https with Sign in with GitHub", { timeout: 60_000 }, () => {
  let folder: string;
  let server: TokenGitServer;
  let user: UserCredentials;
  let userToken: TestUserToken;
  let helper: GitCredentialHelper;
  let identity: OfficeIdentity;
  let remote: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-identity-github-"));
    const repositories = join(folder, "repositories");
    await mkdir(repositories);
    await bareRepositoryWithOneCommit(join(repositories, "repo.git"), join(folder, "seed"));
    server = await startTokenGitServer(repositories, TOKEN);
    remote = `${server.origin}/repo.git`;
    // The user's helper scoped to GitHub, as `gh auth setup-git` writes one.
    user = await userCredentials(server.origin);
    userToken = new TestUserToken(server.origin);
    const identityFolder = new IdentityFolder(new OfficeDataDirectory(join(folder, "office")));
    helper = new GitCredentialHelper(identityFolder);
    identity = new OfficeIdentity(
      new OfficeSshKey(identityFolder),
      new OfficeKnownHosts(identityFolder, new NoHostKeyScanner(), userToken),
      new OfficeGitHome(identityFolder),
      helper,
      userToken,
    );
  });

  afterEach(async () => {
    await helper.onModuleDestroy();
    await server.close();
    await user.remove();
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  });

  /** Runs git on the identity, as Office code does, releasing it once git exits. */
  async function onIdentity(
    gitArguments: readonly string[],
  ): Promise<{ exitCode: number; stderr: string; identity: GitCommandIdentity }> {
    const command = await identity.forGitCommand(remote, user.environment);
    // Plain http stands in for https, which the identity allows alone.
    const result = await gitCommand([...command.configArguments, ...gitArguments], {
      ...command.variables,
      GIT_ALLOW_PROTOCOL: "http:file",
    }).finally(() => command.release());
    return { ...result, identity: command };
  }

  it("decides that a remote is on GitHub by GitHub's website, as the token is given", async () => {
    const elsewhere = officeIdentityForTests(
      join(folder, "office"),
      new TestUserToken("https://github.example.test"),
    );

    expect(await elsewhere.needsOf("https://github.example.test/octo/repo.git")).toEqual({
      kind: "github-https",
      missing: [],
    });
    expect(await elsewhere.needsOf("https://github.com/octo/repo.git")).toEqual({
      kind: "anonymous-https",
      host: "github.com",
    });
  });

  it("is reached anonymously while signed out, without reading the token", async () => {
    userToken.signedIn = false;

    const { exitCode, stderr } = await onIdentity(["ls-remote", remote]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/terminal prompts disabled/);
    expect(userToken.reads).toBe(0);
    expect(server.authorizations).not.toContain(basic(TOKEN));
  });

  it("fails the command with the reason when the token can't be had", async () => {
    userToken.read = () =>
      Promise.reject(
        new Error("GitHub couldn't be reached. The GitHub token couldn't be renewed."),
      );

    const { exitCode, stderr } = await onIdentity(["ls-remote", remote]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("The GitHub token couldn't be renewed.");
  });

  it("says Sign in with GitHub ended when a refresh signed the user out", async () => {
    userToken.read = () => Promise.resolve(undefined);

    const { exitCode, stderr } = await onIdentity(["ls-remote", remote]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Settings › Office identity");
  });
});
