import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { currentOperatingSystem } from "../os/current-operating-system.js";
import { startFakeGitHubMeta, type FakeGitHubMeta } from "./fake-github-meta.fixtures.js";
import { IdentityFolder } from "./identity-folder.js";
import { NoHostKeyScanner } from "./office-identity.fixtures.js";
import { OfficeIdentity, type GitCommandIdentity } from "./office-identity.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";
import {
  startFakeGitHttpServer,
  userCredentials,
  type FakeGitHttpServer,
  type UserCredentials,
} from "./user-credentials.fixtures.js";

const run = promisify(execFile);
const [bash] = currentOperatingSystem().agentShells;

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

/** A path as the identity hands it to ssh. */
function forSsh(path: string): string {
  return path.split("\\").join("/");
}

/** The configuration ssh resolves for the identity's command and a host, from `ssh -G`. */
async function resolvedSshConfig(identity: GitCommandIdentity): Promise<Map<string, string>> {
  if (bash === undefined) throw new Error("No Bash to run ssh in.");
  const invocation = bash.invocation(`${identity.variables["GIT_SSH_COMMAND"]} -G github.com`);
  const { stdout } = await run(invocation.file, invocation.arguments, {
    env: identity.variables,
    windowsHide: true,
  });
  return new Map(
    stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const space = line.indexOf(" ");
        return [line.slice(0, space), line.slice(space + 1)] as const;
      })
      .reduce(
        (entries, [name, value]) => {
          const earlier = entries.find((entry) => entry[0] === name);
          if (earlier) earlier[1] += `\n${value}`;
          else entries.push([name, value]);
          return entries;
        },
        [] as [string, string][],
      ),
  );
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
    knownHosts = new OfficeKnownHosts(folder, new NoHostKeyScanner(), meta.url);
    identity = new OfficeIdentity(sshKey, knownHosts);
  });

  afterEach(async () => {
    await meta.close();
    await rm(officeData, { recursive: true, force: true });
  });

  it("clears the user's credential helpers and keeps their other config", async () => {
    const { configArguments } = await identity.forGitCommand(undefined, USER_ENVIRONMENT);

    expect(configArguments).toEqual([
      "-c",
      "credential.helper=",
      "-c",
      "core.askPass=",
      "-c",
      "http.extraHeader=",
      "-c",
      "http.emptyAuth=true",
    ]);
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
      "http.https://github.com/octo/repo.git.emptyAuth=true",
    ]);
  });

  it("keeps the user's agent, askpass, ssh command and The Office's own variables out", async () => {
    const { variables } = await identity.forGitCommand(undefined, USER_ENVIRONMENT);

    expect(variables).toMatchObject({
      HOME: "/home/user",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
      GIT_SSH_VARIANT: "ssh",
      GIT_ALLOW_PROTOCOL: "https:ssh",
    });
    for (const name of ["SSH_AUTH_SOCK", "GIT_ASKPASS", "SSH_ASKPASS", "DATABASE_URL", "UNSET"]) {
      expect(variables).not.toHaveProperty(name);
    }
    expect(variables["GIT_SSH_COMMAND"]).not.toContain("id_ed25519");
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

  it("runs ssh with the Office ssh key alone and The Office's own known hosts", async () => {
    const config = await resolvedSshConfig(
      await identity.forGitCommand("git@github.com:octo/repo.git", USER_ENVIRONMENT),
    );

    // ssh shows the key's file as given, its `%` escaped, and the known hosts' expanded.
    expect(config.get("identityfile")).toBe(forSsh(sshKey.privateKeyPath).replace("%", "%%"));
    expect(config.get("userknownhostsfile")).toBe(forSsh(knownHosts.path));
    expect(Object.fromEntries(config)).toMatchObject({
      identitiesonly: "yes",
      identityagent: "none",
      globalknownhostsfile: "none",
      stricthostkeychecking: "true",
      updatehostkeys: "false",
      batchmode: "yes",
    });
  });

  describe("what a remote needs", () => {
    it("is Sign in with GitHub for GitHub over https, missing while nothing signs in", async () => {
      expect(await identity.needsOf("https://github.com/octo/repo.git")).toEqual({
        kind: "github-https",
        missing: ["sign-in-with-github"],
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

    // The controls show each credential is there to be reached, so the identity's runs prove something.
    it("are reached by git run without the identity", async () => {
      await gitCommand([], ["ls-remote", `${server.origin}/repo.git`], user.environment);
      await gitCommand([], ["ls-remote", "ssh://git@127.0.0.1:1/repo.git"], user.environment);

      expect(await user.reached()).toEqual([
        "credential-helper",
        "scoped-credential-helper",
        "ssh-config",
      ]);
      expect(server.authorizations).toContain(user.netrcAuthorization);
    });

    it("are not reached over http: no credential helper, scoped or not, and no .netrc", async () => {
      const remote = `${server.origin}/repo.git`;
      const { configArguments, variables } = await identity.forGitCommand(remote, user.environment);

      // Plain http, which the identity refuses, stands in for https: curl reads .netrc for both.
      const { stderr } = await gitCommand(configArguments, ["ls-remote", remote], {
        ...variables,
        GIT_ALLOW_PROTOCOL: "http",
      });

      expect(stderr).toMatch(/terminal prompts disabled/);
      expect(server.authorizations.length).toBeGreaterThan(0);
      expect(server.authorizations).not.toContain(user.netrcAuthorization);
      expect(await user.reached()).toEqual([]);
    });

    it("are not reached over ssh: neither the user's ssh command nor their ssh config", async () => {
      const remote = "ssh://git@127.0.0.1:1/repo.git";
      const { configArguments, variables } = await identity.forGitCommand(remote, user.environment);

      const { exitCode } = await gitCommand(configArguments, ["ls-remote", remote], variables);

      expect(exitCode).not.toBe(0);
      expect(await user.reached()).toEqual([]);
    });
  });
});

/** Runs git, failing or not, with `configArguments` before the subcommand. */
async function gitCommand(
  configArguments: readonly string[],
  gitArguments: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ exitCode: number; stderr: string }> {
  return run("git", [...configArguments, ...gitArguments], {
    env: environment,
    timeout: 20_000,
    windowsHide: true,
  }).then(
    ({ stderr }) => ({ exitCode: 0, stderr }),
    (error: { code?: number; stderr?: string }) => ({
      exitCode: error.code ?? -1,
      stderr: error.stderr ?? "",
    }),
  );
}
