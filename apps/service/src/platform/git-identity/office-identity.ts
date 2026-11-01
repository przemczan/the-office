import { Injectable, Optional } from "@nestjs/common";
import { isOfficeOwnVariable } from "../config/office-config.js";
import { currentOperatingSystem } from "../os/current-operating-system.js";
import {
  GitCredentialHelper,
  type GitCredentialAnswer,
  type GitCredentialGrant,
} from "./git-credential-helper.js";
import { parseGitRemote, type GitRemote } from "./git-remote.js";
import { GitHubUserToken } from "./github-user-token.js";
import { OfficeGitHome, userGlobalConfig } from "./office-git-home.js";
import { GITHUB_SITE, type GitHubSite } from "./github-site.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";
import { forSh, shellQuoted } from "./sh-words.js";
import type { MissingForSsh, RemoteNeeds } from "./remote-needs.js";

/** How one git command runs on the Office identity. */
export interface GitCommandIdentity {
  /** Goes between `git` and its subcommand: `git <configArguments> -C <folder> fetch …`. */
  readonly configArguments: readonly string[];
  /** The command's whole environment. */
  readonly variables: Readonly<Record<string, string>>;
  /** Called once the command has exited: what it was let ask for ends. */
  release(): void;
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
 * http settings that would hand the user's credentials to a host. An empty user name lets curl
 * answer a 401 with the Windows sign-in (NTLM or Negotiate), and git's automatic empty auth turns
 * it on once a 401 offers NTLM, so it is off. curl's `.netrc` is out of reach through HOME instead.
 */
const HTTP_SETTINGS: readonly string[] = ["extraHeader=", "emptyAuth=false"];

/**
 * The Office identity for git (spec §5.5 Defaults): every Office git command runs with only The
 * Office's own credentials. A command that reaches an ssh remote gets the Office ssh key made
 * first, and GitHub's host keys when it reaches GitHub.
 */
@Injectable()
export class OfficeIdentity {
  private readonly operatingSystem = currentOperatingSystem();
  private readonly gitHub: GitHubSite;

  constructor(
    private readonly sshKey: OfficeSshKey,
    private readonly knownHosts: OfficeKnownHosts,
    private readonly gitHome: OfficeGitHome,
    private readonly credentialHelper: GitCredentialHelper,
    @Optional() private readonly gitHubUserToken?: GitHubUserToken,
  ) {
    this.gitHub = gitHubUserToken ?? GITHUB_SITE;
  }

  /** Which part of the identity `remote` needs and what of it is missing, changing nothing. */
  async needsOf(remote: string): Promise<RemoteNeeds> {
    const reached = parseGitRemote(remote);
    switch (reached.transport) {
      case "https":
        if (!this.isGitHubWebsite(remote)) return { kind: "anonymous-https", host: reached.host };
        return {
          kind: "github-https",
          missing: (await this.gitHubUserToken?.isSignedIn()) ? [] : ["sign-in-with-github"],
        };
      case "ssh":
        return {
          kind: "ssh",
          host: reached.host,
          port: reached.port,
          missing: await this.missingForSsh(reached),
        };
      case "local":
        return { kind: "local" };
      case "other":
        return { kind: "refused", scheme: reached.scheme };
    }
  }

  /**
   * Lists an ssh host as waiting for the user to confirm its fingerprint, for a refusal that sends
   * them to confirm it before any git command reaches the host.
   */
  awaitHostKeyConfirmation(host: string, port: number): Promise<void> {
    return this.knownHosts.awaitConfirmation(host, port);
  }

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
      if (this.knownHosts.isGitHub(reached.host, reached.port)) await this.knownHosts.trustGitHub();
      // ssh will refuse an untrusted host, which then waits for the user to confirm its key.
      else await this.knownHosts.awaitConfirmation(reached.host, reached.port);
    }
    const sameVariableName = (one: string, other: string): boolean =>
      this.operatingSystem.sameVariableName(one, other);
    const userConfig = userGlobalConfig(
      inherited,
      this.operatingSystem.gitHomeDirectory(inherited),
      sameVariableName,
    );
    const gitHubGrant = await this.gitHubGrant(remote);
    return gitCommandIdentity({
      remote,
      reached,
      inherited,
      gitHubGrant,
      ssh: {
        ssh: this.operatingSystem.sshPrograms.ssh,
        privateKey: this.sshKey.privateKeyPath,
        knownHosts: this.knownHosts.path,
      },
      home: {
        home: this.gitHome.path,
        globalConfig: await this.gitHome.globalConfigIncluding(userConfig.files),
        xdgConfigHome: userConfig.xdgConfigHome,
        kerberosCredentialCache: this.gitHome.noKerberosTickets,
      },
      sameVariableName,
    });
  }

  /**
   * Leave for a command that reaches GitHub over https to ask for the user token, while signed in.
   * The token is read only when git asks, so a public repository needs no refresh.
   */
  private async gitHubGrant(remote: string | undefined): Promise<GitCredentialGrant | undefined> {
    const userToken = this.gitHubUserToken;
    if (userToken === undefined || remote === undefined) return undefined;
    if (!this.isGitHubWebsite(remote)) return undefined;
    if (!(await userToken.isSignedIn())) return undefined;
    return this.credentialHelper.grant(userToken.webUrl, () => tokenAnswer(userToken));
  }

  /** Whether `remote` is a URL on GitHub's website, by its origin, as the credential helper matches it. */
  private isGitHubWebsite(remote: string): boolean {
    return originOf(remote) === new URL(this.gitHub.webUrl).origin;
  }

  /** GitHub's host keys are trusted from its published list when first needed, so never missing. */
  private async missingForSsh({
    host,
    port,
  }: {
    readonly host: string;
    readonly port: number;
  }): Promise<MissingForSsh[]> {
    const [keyMade, hostTrusted] = await Promise.all([
      this.sshKey.isMade(),
      this.knownHosts.isGitHub(host, port) || this.knownHosts.isTrusted(host, port),
    ]);
    return [
      ...(keyMade ? [] : ["office-ssh-key" as const]),
      ...(hostTrusted ? [] : ["host-key" as const]),
    ];
  }
}

interface GitCommandIdentityInput {
  readonly remote: string | undefined;
  readonly reached: GitRemote | undefined;
  readonly inherited: Readonly<Record<string, string | undefined>>;
  readonly gitHubGrant: GitCredentialGrant | undefined;
  readonly ssh: SshFiles;
  readonly home: GitHome;
  readonly sameVariableName: (one: string, other: string) => boolean;
}

/** The home a git command runs with, and what of the user's it keeps reading. */
export interface GitHome {
  readonly home: string;
  /** The Office's global config file, including the user's. */
  readonly globalConfig: string;
  /** The user's, where git finds its default global ignore and attributes files. */
  readonly xdgConfigHome: string;
  readonly kerberosCredentialCache: string;
}

/**
 * The user's credential helpers are cleared, never their global or system config, which holds
 * filters such as LFS's. `GIT_SSH_COMMAND` overrides `core.sshCommand`.
 */
export function gitCommandIdentity({
  remote,
  reached,
  inherited,
  gitHubGrant,
  ssh,
  home,
  sameVariableName,
}: GitCommandIdentityInput): GitCommandIdentity {
  const identityVariables: Record<string, string> = {
    // curl and git-lfs read `.netrc` from HOME; `~` in the user's config then means this folder.
    HOME: home.home,
    GIT_CONFIG_GLOBAL: home.globalConfig,
    XDG_CONFIG_HOME: home.xdgConfigHome,
    KRB5CCNAME: home.kerberosCredentialCache,
    GIT_TERMINAL_PROMPT: "0",
    // git's traces of http leave the Authorization header out, whatever the user's environment says.
    GIT_TRACE_REDACT: "1",
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
      ...(gitHubGrant?.configArguments ?? []),
      "-c",
      "core.askPass=",
      ...HTTP_SETTINGS.flatMap((setting) => ["-c", `http.${setting}`]),
      // A setting for the remote's own URL outranks the one for every URL.
      ...(reached?.transport === "https" && remote !== undefined && !remote.includes("=")
        ? HTTP_SETTINGS.flatMap((setting) => ["-c", `http.${remote}.${setting}`])
        : []),
    ],
    variables: { ...Object.fromEntries(kept), ...identityVariables },
    release: () => gitHubGrant?.release(),
  };
}

/**
 * The user token as git's helper is answered: signed out while the command ran is said, never
 * answered anonymously, since git asks only once GitHub wanted credentials.
 */
async function tokenAnswer(userToken: GitHubUserToken): Promise<GitCredentialAnswer> {
  const token = await userToken.userToken();
  if (token !== undefined) return { kind: "token", token };
  return {
    kind: "refused",
    reason:
      "Sign in with GitHub ended, so git couldn't be given GitHub's token. Settings › Office identity says why; sign in again there.",
  };
}

/** The origin of a URL remote; none for the scp-like syntax or a path. */
function originOf(remote: string): string | undefined {
  try {
    return new URL(remote).origin;
  } catch {
    return undefined;
  }
}

/**
 * ssh with the Office ssh key alone: no config file, no agent and The Office's own known hosts,
 * where an unknown host is refused and never added. BatchMode keeps it from asking anything.
 */
function sshCommand({ ssh, privateKey, knownHosts }: SshFiles): string {
  return [
    shellQuoted(forSh(ssh)),
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

/** A file goes in as an option, not `-i`, which ssh checks unexpanded and then reads expanded. */
function fileOption(name: string, path: string): string {
  return `-o ${shellQuoted(`${name}=${sshConfigQuoted(percentEscaped(forSh(path)))}`)}`;
}

/** ssh reads `%` in a file name as one of its tokens. */
function percentEscaped(path: string): string {
  return path.replaceAll("%", "%%");
}

/** ssh splits an option's value at spaces unless it is quoted. */
function sshConfigQuoted(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}
