import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { GitCredentialHelper } from "./git-credential-helper.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeGitHome } from "./office-git-home.js";
import { NoHostKeyScanner } from "./office-identity.fixtures.js";
import { OfficeIdentity, type GitCommandIdentity } from "./office-identity.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";
import { startTokenGitServer, type TokenGitServer } from "./token-git-server.fixtures.js";
import { userCredentials, type UserCredentials } from "./user-credentials.fixtures.js";
import {
  TOKEN,
  COMMIT_AS,
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

  it("clones and pushes with the token, which the user's helpers never see", async () => {
    const clone = join(folder, "clone");

    const cloned = await onIdentity(["clone", "-q", remote, clone]);
    await writeFile(join(clone, "change.txt"), "change\n");
    await gitCommand(["-C", clone, "add", "change.txt"], user.environment);
    await gitCommand(["-C", clone, ...COMMIT_AS, "commit", "-qm", "Change"], user.environment);
    const pushed = await onIdentity(["-C", clone, "push", "-q", "origin", "HEAD:refs/heads/task"]);

    expect(cloned).toMatchObject({ exitCode: 0 });
    expect(pushed).toMatchObject({ exitCode: 0 });
    expect(server.authorizations).toContain(basic(TOKEN));
    expect(await user.reached()).toEqual([]);
  });

  it("puts the token in no argument, environment variable or hook's environment", async () => {
    const clone = join(folder, "clone");
    await onIdentity(["clone", "-q", remote, clone]);
    const hookEnvironment = join(folder, "pre-push-environment.txt");
    const hook = join(clone, ".git", "hooks", "pre-push");
    await writeFile(hook, `#!/bin/sh\nenv > '${hookEnvironment.split("\\").join("/")}'\n`);
    await chmod(hook, 0o755);

    const pushed = await onIdentity([
      "-C",
      clone,
      "push",
      "-q",
      "origin",
      "HEAD:refs/heads/hooked",
    ]);

    expect(pushed).toMatchObject({ exitCode: 0 });
    const seen = await readFile(hookEnvironment, "utf8");
    expect(seen).toContain("GIT_CONFIG_PARAMETERS");
    expect(seen).not.toContain(TOKEN);
    expect(JSON.stringify(pushed.identity)).not.toContain(TOKEN);
  });

  it("gives nothing to a host other than GitHub, nor once the command has exited", async () => {
    const grant = await helper.grant(server.origin, () =>
      Promise.resolve({ kind: "token", token: TOKEN }),
    );
    const [, port, secret] = /(\d+) ([0-9a-f]+)$/.exec(grant.configArguments[1] ?? "") ?? [];
    const ask = (host: string): Promise<Response> =>
      fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: `protocol=http\nhost=${host}\n`,
      });

    const otherHost = await ask("git.example.test");
    const granted = await ask(new URL(server.origin).host);
    grant.release();
    const released = await ask(new URL(server.origin).host);

    expect(otherHost.status).toBe(403);
    expect(await granted.text()).toContain(`password=${TOKEN}`);
    expect(released.status).toBe(403);
  });
});
