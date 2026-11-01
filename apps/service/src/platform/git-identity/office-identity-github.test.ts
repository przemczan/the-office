import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { GitCredentialHelper } from "./git-credential-helper.js";
import { GitHubUserToken } from "./github-user-token.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeGitHome } from "./office-git-home.js";
import { NoHostKeyScanner, officeIdentityForTests } from "./office-identity.fixtures.js";
import { OfficeIdentity, type GitCommandIdentity } from "./office-identity.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";
import { startTokenGitServer, type TokenGitServer } from "./token-git-server.fixtures.js";
import { userCredentials, type UserCredentials } from "./user-credentials.fixtures.js";

const run = promisify(execFile);
const TOKEN = "ghu_office-test-token-0123456789";
const COMMIT_AS = ["-c", "user.name=Test", "-c", "user.email=test@example.test"];

/** The github module's access as a test sets it: signed in or not, and what the token read does. */
class TestUserToken extends GitHubUserToken {
  signedIn = true;
  read: () => Promise<string | undefined> = () => Promise.resolve(TOKEN);
  reads = 0;
  /** Nothing listens on the discard port, so a test that reaches GitHub's list unasked fails. */
  readonly apiUrl = "http://127.0.0.1:9";

  constructor(readonly webUrl: string) {
    super();
  }

  isSignedIn(): Promise<boolean> {
    return Promise.resolve(this.signedIn);
  }

  userToken(): Promise<string | undefined> {
    this.reads += 1;
    return this.read();
  }
}

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

async function bareRepositoryWithOneCommit(bare: string, seed: string): Promise<void> {
  await gitCommand(["init", "-q", "--bare", bare], process.env);
  await gitCommand(["init", "-q", seed], process.env);
  await writeFile(join(seed, "README.md"), "seed\n");
  await gitCommand(["-C", seed, "add", "README.md"], process.env);
  await gitCommand(["-C", seed, ...COMMIT_AS, "commit", "-qm", "Seed"], process.env);
  await gitCommand(["-C", seed, "push", "-q", bare, "HEAD:refs/heads/main"], process.env);
  await gitCommand(["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"], process.env);
}

function basic(token: string): string {
  return `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

async function gitCommand(
  gitArguments: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ exitCode: number; stderr: string }> {
  return run("git", [...gitArguments], {
    env: environment,
    timeout: 30_000,
    windowsHide: true,
  }).then(
    ({ stderr }) => ({ exitCode: 0, stderr }),
    (error: { code?: number; stderr?: string }) => ({
      exitCode: error.code ?? -1,
      stderr: error.stderr ?? "",
    }),
  );
}
