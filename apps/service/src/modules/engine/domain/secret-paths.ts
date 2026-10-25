import type { SessionRules } from "./session-rules.js";

/**
 * A variable as Bash (`$NAME`, `${NAME}`), PowerShell (`$env:NAME`, `${env:NAME}`) or cmd.exe
 * (`%NAME%`) names it.
 */
const VARIABLE =
  /\$\{env:([A-Za-z_]\w*)\}|\$env:([A-Za-z_]\w*)|\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)|%([A-Za-z_][\w()]*)%/gi;

/** `~` alone or before a slash: the home folder. */
const HOME = /^~(?=$|[\\/])/;

/** Variables a shell sets to the home folder itself when the environment doesn't: Git Bash's HOME, PowerShell's $HOME. */
const HOME_VARIABLES: ReadonlySet<string> = new Set(["HOME", "USERPROFILE"]);

/**
 * Finds the secrets of spec §6 in what a tool call names: the user's (SSH keys, credentials,
 * browser profiles) and The Office's own files. The session's own folders are never secret, so
 * its worktree inside the Office data directory stays its own.
 */
export class SecretPaths {
  /** Each user secret inside the home folder by its names from there, as `cd ~ && cat .ssh/id` names it. */
  private readonly homeTails: readonly { readonly secret: string; readonly names: string[] }[];

  constructor(private readonly rules: SessionRules) {
    const home = rules.paths.names(rules.homeFolder);
    this.homeTails = rules.userSecrets
      .filter((secret) => rules.paths.isWithin(secret, rules.homeFolder))
      .map((secret) => ({ secret, names: rules.paths.names(secret).slice(home.length) }))
      .filter(({ names }) => names.length > 0);
  }

  /**
   * The secret a path or a command's word names, or undefined. A word is read with the session's
   * variables expanded and relative to the working folder, and so is what follows each `=` in it,
   * as in `--key-file=~/.ssh/id`.
   */
  namedBy(word: string): string | undefined {
    const expanded = this.expand(word);
    const candidates = [expanded, ...expanded.split("=").slice(1)];
    for (const candidate of candidates) {
      const secret = this.byHomeTail(candidate) ?? this.byPath(candidate);
      if (secret !== undefined) return secret;
    }
    return undefined;
  }

  private byHomeTail(candidate: string): string | undefined {
    const names = this.rules.paths.names(candidate);
    return this.homeTails.find((tail) => containsInOrder(names, tail.names))?.secret;
  }

  private byPath(candidate: string): string | undefined {
    const { paths, workingFolder, readableFolders, userSecrets, officeFiles } = this.rules;
    const path = paths.resolve(workingFolder, candidate);
    if ([workingFolder, ...readableFolders].some((folder) => paths.isWithin(path, folder))) {
      return undefined;
    }
    return [...userSecrets, ...officeFiles].find((secret) => paths.isWithin(path, secret));
  }

  private expand(word: string): string {
    return word
      .replace(HOME, this.rules.homeFolder)
      .replaceAll(VARIABLE, (whole, ...names: (string | undefined)[]) => {
        const name = names.slice(0, 5).find((candidate) => candidate !== undefined) ?? "";
        return this.variable(name) ?? whole;
      });
  }

  private variable(name: string): string | undefined {
    const value = Object.entries(this.rules.environment).find(
      ([variable]) => variable.toUpperCase() === name.toUpperCase(),
    )?.[1];
    return value ?? (HOME_VARIABLES.has(name.toUpperCase()) ? this.rules.homeFolder : undefined);
  }
}

/** Whether `part` appears in `names` as consecutive names. */
function containsInOrder(names: readonly string[], part: readonly string[]): boolean {
  return names.some((_, start) => part.every((name, offset) => names[start + offset] === name));
}
