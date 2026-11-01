import { sep } from "node:path";
import { Injectable } from "@nestjs/common";
import { isOfficeOwnVariable } from "../config/office-config.js";
import { currentOperatingSystem } from "../os/current-operating-system.js";
import { parseGitRemote, type GitRemote } from "./git-remote.js";
import { GITHUB_HOST, OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";

/** How one git command runs on the Office identity. */
export interface GitCommandIdentity {
  /** Goes between `git` and its subcommand: `git <configArguments> -C <folder> fetch …`. */
  readonly configArguments: readonly string[];
  /** The command's whole environment. */
  readonly variables: Readonly<Record<string, string>>;
}

/** The files ssh runs with. */
export interface SshFiles {
  readonly ssh: string;
  readonly privateKey: string;
  readonly knownHosts: string;
}

/**
 * What would reach the user's credentials or wait on a prompt: their ssh agent, askpass programs
 * (git asks them before it reads GIT_TERMINAL_PROMPT, and VS Code sets GIT_ASKPASS in its
 * terminals), and their own ssh command, which the identity's replaces.
 */
const USER_CREDENTIAL_VARIABLES: readonly string[] = [
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "SSH_ASKPASS",
  "SSH_ASKPASS_REQUIRE",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_SSH_VARIANT",
];

/**
 * The Office identity for git (spec §5.5 Defaults): every Office git command runs with only The
 * Office's own credentials. A command that reaches an ssh remote gets the Office ssh key made
 * first, and GitHub's host keys when it reaches GitHub.
 */
@Injectable()
export class OfficeIdentity {
  private readonly operatingSystem = currentOperatingSystem();

  constructor(
    private readonly sshKey: OfficeSshKey,
    private readonly knownHosts: OfficeKnownHosts,
  ) {}

  /**
   * The identity for a git command that reaches `remote` (a URL, the scp-like syntax or a path),
   * or none when it reaches no remote; `inherited` is the environment it would have had.
   */
  async forGitCommand(
    remote: string | undefined,
    inherited: Readonly<Record<string, string | undefined>>,
  ): Promise<GitCommandIdentity> {
    const reached = remote === undefined ? undefined : parseGitRemote(remote);
    if (reached?.transport === "ssh") {
      await this.sshKey.ensure();
      if (reached.host === GITHUB_HOST) await this.knownHosts.trustGitHub();
    }
    return gitCommandIdentity({
      remote,
      reached,
      inherited,
      ssh: {
        ssh: this.operatingSystem.sshPrograms.ssh,
        privateKey: this.sshKey.privateKeyPath,
        knownHosts: this.knownHosts.path,
      },
      sameVariableName: (one, other) => this.operatingSystem.sameVariableName(one, other),
    });
  }
}

interface GitCommandIdentityInput {
  readonly remote: string | undefined;
  readonly reached: GitRemote | undefined;
  readonly inherited: Readonly<Record<string, string | undefined>>;
  readonly ssh: SshFiles;
  readonly sameVariableName: (one: string, other: string) => boolean;
}

/**
 * The user's credential helpers are cleared, never their global or system config, which holds
 * filters such as LFS's. `GIT_SSH_COMMAND` overrides `core.sshCommand`.
 */
export function gitCommandIdentity({
  remote,
  reached,
  inherited,
  ssh,
  sameVariableName,
}: GitCommandIdentityInput): GitCommandIdentity {
  const identityVariables: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_SSH_COMMAND: sshCommand(ssh),
    GIT_SSH_VARIANT: "ssh",
    // A local remote's own transport, and https and ssh; never one a submodule's URL could pick.
    GIT_ALLOW_PROTOCOL: reached?.transport === "local" ? "https:ssh:file" : "https:ssh",
  };
  const replaced = [...USER_CREDENTIAL_VARIABLES, ...Object.keys(identityVariables)];
  const kept = Object.entries(inherited).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !isOfficeOwnVariable(entry[0]) &&
      !replaced.some((name) => sameVariableName(name, entry[0])),
  );
  return {
    configArguments: [
      "-c",
      "credential.helper=",
      "-c",
      "core.askPass=",
      "-c",
      "http.extraHeader=",
      // A header set for the remote's own URL outranks the one for every URL.
      ...(reached?.transport === "https" && remote !== undefined && !remote.includes("=")
        ? ["-c", `http.${remote}.extraHeader=`]
        : []),
    ],
    variables: { ...Object.fromEntries(kept), ...identityVariables },
  };
}

/**
 * ssh with the Office ssh key alone: no config file, no agent and The Office's own known hosts,
 * where an unknown host is refused and never added. BatchMode keeps it from asking anything.
 */
function sshCommand({ ssh, privateKey, knownHosts }: SshFiles): string {
  // A file goes in as an option, not `-i`, which ssh checks unexpanded and then reads expanded.
  const fileOption = (name: string, path: string): string =>
    `-o ${shellQuoted(`${name}=${sshConfigQuoted(percentEscaped(forSsh(path)))}`)}`;
  return [
    shellQuoted(forSsh(ssh)),
    "-F none",
    fileOption("IdentityFile", privateKey),
    "-o IdentitiesOnly=yes",
    "-o IdentityAgent=none",
    fileOption("UserKnownHostsFile", knownHosts),
    "-o GlobalKnownHostsFile=none",
    "-o StrictHostKeyChecking=yes",
    "-o UpdateHostKeys=no",
    "-o BatchMode=yes",
  ].join(" ");
}

/** git runs GIT_SSH_COMMAND in sh, which takes Windows paths with forward slashes only. */
function forSsh(path: string): string {
  return path.split(sep).join("/");
}

function shellQuoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** ssh reads `%` in a file name as one of its tokens. */
function percentEscaped(path: string): string {
  return path.replaceAll("%", "%%");
}

/** ssh splits an option's value at spaces unless it is quoted. */
function sshConfigQuoted(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}
