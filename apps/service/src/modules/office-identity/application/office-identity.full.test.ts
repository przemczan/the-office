import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { startFakeGitHubMeta, type FakeGitHubMeta } from "./fake-github-meta.fixtures.js";
import { GitCredentialHelper } from "./git-credential-helper.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeGitHome } from "./office-git-home.js";
import { NoHostKeyScanner } from "./office-identity.fixtures.js";
import { OfficeIdentity } from "./office-identity.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";
import {
  isGitLfsInstalled,
  repositoryWithLfsPointer,
  startFakeGitHttpServer,
  USER_IGNORED_EXTENSION,
  USER_LFS_CONCURRENT_TRANSFERS,
  USER_NAME,
  userCredentials,
  type FakeGitHttpServer,
  type UserCredentials,
} from "./user-credentials.fixtures.js";

const run = promisify(execFile);
const gitLfsInstalled = await isGitLfsInstalled();

const USER_ENVIRONMENT = {
  PATH: process.env["PATH"],
  HOME: "/home/user",
  SSH_AUTH_SOCK: "/tmp/agent.sock",
  GIT_ASKPASS: "/usr/bin/code-askpass",
  SSH_ASKPASS: "/usr/bin/ssh-askpass",
  GIT_SSH_COMMAND: "ssh -i ~/.ssh/id_ed25519",
  GIT_TERMINAL_PROMPT: "1",
  DATABASE_URL: "postgres://office:secret@localhost/office",
  UNSET: undefined,
};

/** A path as the identity hands it to ssh, and as its global config file includes one. */
function forSsh(path: string): string {
  return path.split("\\").join("/");
}

describe("OfficeIdentity", { timeout: 30_000 }, () => {
  let officeData: string;
  let meta: FakeGitHubMeta;
  let sshKey: OfficeSshKey;
  let knownHosts: OfficeKnownHosts;
  let identity: OfficeIdentity;

  beforeEach(async () => {
    // A space, a quote and a percent sign, which sh and ssh would each read otherwise.
    officeData = await mkdtemp(join(tmpdir(), "office identity's 100% "));
    meta = await startFakeGitHubMeta();
    const folder = new IdentityFolder(new OfficeDataDirectory(officeData));
    sshKey = new OfficeSshKey(folder);
    knownHosts = new OfficeKnownHosts(folder, new NoHostKeyScanner(), meta.site);
    identity = new OfficeIdentity(
      sshKey,
      knownHosts,
      new OfficeGitHome(folder),
      new GitCredentialHelper(folder),
    );
  });

  afterEach(async () => {
    await meta.close();
    await rm(officeData, { recursive: true, force: true });
  });

  it("sets the http settings for the remote's own URL too", async () => {
    const { configArguments } = await identity.forGitCommand(
      "https://github.com/octo/repo.git",
      USER_ENVIRONMENT,
    );

    expect(configArguments.slice(-4)).toEqual([
      "-c",
      "http.https://github.com/octo/repo.git.extraHeader=",
      "-c",
      "http.https://github.com/octo/repo.git.emptyAuth=false",
    ]);
  });

  it("runs git in a home of The Office's own, reading the user's global config by its include", async () => {
    const { variables } = await identity.forGitCommand(undefined, USER_ENVIRONMENT);

    const identityFolder = join(officeData, "identity");
    expect(variables).toMatchObject({
      HOME: join(identityFolder, "home"),
      XDG_CONFIG_HOME: join("/home/user", ".config"),
      KRB5CCNAME: `FILE:${join(identityFolder, "no-kerberos-tickets")}`,
    });
    await access(join(identityFolder, "home"));
    const globalConfig = variables["GIT_CONFIG_GLOBAL"] ?? "";
    expect(dirname(globalConfig)).toBe(identityFolder);
    expect(await readFile(globalConfig, "utf8")).toContain(
      [
        "[include]",
        `\tpath = "${forSsh(join("/home/user", ".config", "git", "config"))}"`,
        `\tpath = "${forSsh(join("/home/user", ".gitconfig"))}"`,
      ].join("\n"),
    );
  });

  it("includes the user's own GIT_CONFIG_GLOBAL instead when they set one", async () => {
    const userConfig = join(officeData, "user's.gitconfig");
    const { variables } = await identity.forGitCommand(undefined, {
      ...USER_ENVIRONMENT,
      GIT_CONFIG_GLOBAL: userConfig,
    });

    const globalConfig = await readFile(variables["GIT_CONFIG_GLOBAL"] ?? "", "utf8");
    expect(globalConfig.match(/\tpath = .*/g)).toEqual([
      `\tpath = "${userConfig.split(sep).join("/")}"`,
    ]);
  });

  it("allows the file transport only for a local remote", async () => {
    const local = await identity.forGitCommand(join(officeData, "remote.git"), USER_ENVIRONMENT);
    const https = await identity.forGitCommand("https://example.com/a.git", USER_ENVIRONMENT);

    expect(local.variables["GIT_ALLOW_PROTOCOL"]).toBe("https:ssh:file");
    expect(https.variables["GIT_ALLOW_PROTOCOL"]).toBe("https:ssh");
  });

  it("makes the Office ssh key for an ssh remote only, and trusts GitHub's keys for GitHub", async () => {
    await identity.forGitCommand("https://github.com/octo/repo.git", USER_ENVIRONMENT);
    await expect(access(sshKey.privateKeyPath)).rejects.toThrow(/ENOENT/);
    expect(meta.requests).toBe(0);

    await identity.forGitCommand("git@github.com:octo/repo.git", USER_ENVIRONMENT);

    await access(sshKey.privateKeyPath);
    expect(await knownHosts.isTrusted("github.com", 22)).toBe(true);
  });

  it("lists another ssh host as an Unconfirmed host once a command reaches it", async () => {
    const remote = "ssh://git@git.example:2222/octo/repo.git";
    await identity.needsOf(remote);
    expect(await knownHosts.unconfirmed()).toEqual([]);

    await identity.forGitCommand(remote, USER_ENVIRONMENT);
    await identity.forGitCommand("git@github.com:octo/repo.git", USER_ENVIRONMENT);

    expect(await knownHosts.unconfirmed()).toEqual([{ host: "git.example", port: 2222 }]);
  });

  describe("what a remote needs", () => {
    it("is Sign in with GitHub for GitHub over https, missing while nothing signs in", async () => {
      expect(await identity.needsOf("https://github.com/octo/repo.git")).toEqual({
        kind: "signed-in-https",
        site: "GitHub",
        signIn: "Sign in with GitHub",
        missing: ["sign-in"],
      });
    });

    it("is nothing for another host over https, reached anonymously", async () => {
      expect(await identity.needsOf("https://gitlab.example/octo/repo.git")).toEqual({
        kind: "anonymous-https",
        host: "gitlab.example",
      });
    });

    it("is the Office ssh key and a trusted host key over ssh, without making either", async () => {
      const needs = await identity.needsOf("ssh://git@git.example:2222/octo/repo.git");

      expect(needs).toEqual({
        kind: "ssh",
        host: "git.example",
        port: 2222,
        missing: ["office-ssh-key", "host-key"],
      });
      expect(await sshKey.isMade()).toBe(false);
    });

    it("never misses GitHub's host key, which comes from GitHub's list when first needed", async () => {
      await sshKey.ensure();

      expect(await identity.needsOf("git@github.com:octo/repo.git")).toMatchObject({ missing: [] });
      expect(meta.requests).toBe(0);
    });

    it("is nothing for a local remote, and refuses another transport", async () => {
      expect(await identity.needsOf(join(officeData, "remote.git"))).toEqual({ kind: "local" });
      expect(await identity.needsOf("git://git.example/repo.git")).toEqual({
        kind: "refused",
        scheme: "git",
      });
    });
  });

  describe("the user's own credentials", () => {
    let server: FakeGitHttpServer;
    let user: UserCredentials;

    beforeEach(async () => {
      server = await startFakeGitHttpServer();
      user = await userCredentials(server.origin);
    });

    afterEach(async () => {
      await server.close();
      await user.remove();
    });

    describe.runIf(gitLfsInstalled)("by git-lfs", () => {
      let repository: string;

      beforeEach(async () => {
        repository = await repositoryWithLfsPointer(`${server.origin}/repo.git`);
      });

      afterEach(async () => {
        await rm(repository, { recursive: true, force: true, maxRetries: 5 });
      });

      it("keeps the user's lfs settings, which git-lfs reads through git", async () => {
        const { configArguments, variables } = await identity.forGitCommand(
          undefined,
          user.environment,
        );

        const { stdout } = await run("git", [...configArguments, "-C", repository, "lfs", "env"], {
          env: variables,
          windowsHide: true,
        });

        expect(stdout).toContain(`ConcurrentTransfers=${USER_LFS_CONCURRENT_TRANSFERS}`);
      });
    });

    it("leave the rest of the user's global config applying: XDG, includes, ignores, lfs", async () => {
      const { configArguments, variables } = await identity.forGitCommand(
        undefined,
        user.environment,
      );
      const repository = join(officeData, "repository");
      const git = (...gitArguments: string[]): Promise<{ stdout: string }> =>
        run("git", [...configArguments, "-C", repository, ...gitArguments], {
          env: variables,
          windowsHide: true,
        });
      await run("git", ["init", "-q", repository], { windowsHide: true });

      expect((await git("config", "user.name")).stdout.trim()).toBe(USER_NAME);
      expect((await git("config", "lfs.concurrentTransfers")).stdout.trim()).toBe(
        String(USER_LFS_CONCURRENT_TRANSFERS),
      );
      await expect(
        git("check-ignore", "-q", `file${USER_IGNORED_EXTENSION}`),
      ).resolves.toBeDefined();
    });
  });
});
