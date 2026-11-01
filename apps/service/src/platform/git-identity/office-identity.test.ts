import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { currentOperatingSystem } from "../os/current-operating-system.js";
import { startFakeGitHubMeta, type FakeGitHubMeta } from "./fake-github-meta.fixtures.js";
import { HostKeyScanner } from "./host-key-scanner.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeIdentity, type GitCommandIdentity } from "./office-identity.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";

const run = promisify(execFile);
const [bash] = currentOperatingSystem().agentShells;

class NoScanner extends HostKeyScanner {
  scan(): Promise<never> {
    return Promise.reject(new Error("No host is scanned here."));
  }
}

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
    knownHosts = new OfficeKnownHosts(folder, new NoScanner(), meta.url);
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
    ]);
  });

  it("clears an extra header set for the remote's own URL", async () => {
    const { configArguments } = await identity.forGitCommand(
      "https://github.com/octo/repo.git",
      USER_ENVIRONMENT,
    );

    expect(configArguments.slice(-2)).toEqual([
      "-c",
      "http.https://github.com/octo/repo.git.extraHeader=",
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
});
