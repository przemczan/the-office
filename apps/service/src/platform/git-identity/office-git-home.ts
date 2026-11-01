import { mkdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { Injectable } from "@nestjs/common";
import { IdentityFolder } from "./identity-folder.js";

type Variables = Readonly<Record<string, string | undefined>>;
type SameVariableName = (one: string, other: string) => boolean;

/** Where the user's global git config is, read from the environment a command would have had. */
export interface UserGlobalConfig {
  /** The files git reads as the global config, in its order, each there or not. */
  readonly files: readonly string[];
  /** The folder git finds its default global ignore and attributes files under. */
  readonly xdgConfigHome: string;
}

/**
 * Git's own lookup: `GIT_CONFIG_GLOBAL` when set, else the XDG `git/config` and then
 * `~/.gitconfig`, whose settings win.
 */
export function userGlobalConfig(
  variables: Variables,
  home: string,
  sameVariableName: SameVariableName,
): UserGlobalConfig {
  const variable = (name: string): string | undefined =>
    Object.entries(variables).find(([key]) => sameVariableName(key, name))?.[1] || undefined;
  const xdgConfigHome = variable("XDG_CONFIG_HOME") ?? join(home, ".config");
  const configGlobal = variable("GIT_CONFIG_GLOBAL");
  return {
    files:
      configGlobal === undefined
        ? [join(xdgConfigHome, "git", "config"), join(home, ".gitconfig")]
        : [configGlobal],
    xdgConfigHome,
  };
}

/**
 * The home folder every Office git command runs with, so neither curl nor git-lfs finds the user's
 * `.netrc` (spec §5.5 Defaults). The user's global config still applies through a global config
 * file of The Office's that includes theirs by absolute path.
 */
@Injectable()
export class OfficeGitHome {
  private readonly written = new Map<string, Promise<string>>();

  constructor(private readonly folder: IdentityFolder) {}

  /** The home folder, empty. */
  get path(): string {
    return this.folder.file("home");
  }

  /**
   * A Kerberos credential cache that never exists, so neither curl nor git-lfs finds the user's
   * tickets; Windows' own sign-in (SSPI) doesn't read it.
   */
  get noKerberosTickets(): string {
    return `FILE:${this.folder.file("no-kerberos-tickets")}`;
  }

  /**
   * Makes the home folder and the global config file that includes `userFiles`, once each, and
   * gives that file. A file is named by what it holds, so commands with different users' config
   * never share one.
   */
  globalConfigIncluding(userFiles: readonly string[]): Promise<string> {
    const content = includingConfig(userFiles);
    const existing = this.written.get(content);
    if (existing !== undefined) return existing;
    const writing = this.write(content).catch((error: unknown) => {
      this.written.delete(content);
      throw error;
    });
    this.written.set(content, writing);
    return writing;
  }

  private async write(content: string): Promise<string> {
    await this.folder.prepare();
    await mkdir(this.path, { recursive: true });
    return this.folder.fileHolding("global", ".gitconfig", content);
  }
}

/** A git config file that includes `files` in order; git skips one that isn't there. */
function includingConfig(files: readonly string[]): string {
  return [
    "# The user's global git config, included by The Office for its own git commands.",
    "[include]",
    // Forward slashes on Windows too, which git reads there, so no path relies on escaping.
    ...files.map((file) => `\tpath = ${configValue(file.split(sep).join("/"))}`),
    "",
  ].join("\n");
}

/** A git config value in double quotes, where `\` and `"` are escaped. */
function configValue(text: string): string {
  return `"${text.replace(/[\\"]/g, "\\$&")}"`;
}
