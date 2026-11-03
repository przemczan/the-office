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
 * Finds the secrets of spec §6 in what a tool call names: the user's and The Office's (SSH keys,
 * credentials, browser profiles), and The Office's own files. The session's own folders are never
 * secret, so its worktree inside the Office data directory stays its own; a session reaching the
 * workstation is refused the secrets alone, wherever it works.
 */
export class SecretPaths {
  /** Each secret inside the home folder by its names from there, as `cd ~ && cat .ssh/id` names it. */
  private readonly homeTails: readonly { readonly secret: string; readonly names: string[] }[];

  constructor(private readonly rules: SessionRules) {
    const home = rules.paths.names(rules.homeFolder);
    this.homeTails = rules.secrets
      .filter((secret) => rules.paths.isWithin(secret, rules.homeFolder))
      .map((secret) => ({ secret, names: rules.paths.names(secret).slice(home.length) }))
      .filter(({ names }) => names.length > 0);
  }

  /**
   * The secret a path or a command's word names, or undefined. A word is read with the session's
   * variables expanded and relative to `directory`, the working folder unless a `cd` moved the
   * command elsewhere, and so is what follows each `=` in it, as in `--key-file=~/.ssh/id`.
   */
  namedBy(word: string, directory: string = this.rules.workingFolder): string | undefined {
    const expanded = this.expand(word);
    const candidates = [expanded, ...expanded.split("=").slice(1)];
    for (const candidate of candidates) {
      const secret = this.byHomeTail(candidate) ?? this.byPath(candidate, directory);
      if (secret !== undefined) return secret;
    }
    return undefined;
  }

  private byHomeTail(candidate: string): string | undefined {
    const names = this.rules.paths.names(candidate);
    return this.homeTails.find((tail) => containsInOrder(names, tail.names))?.secret;
  }

  private byPath(candidate: string, directory: string): string | undefined {
    const { paths, workingFolder, readableFolders, secrets, officeFiles, cloneFolders } =
      this.rules;
    const path = paths.resolve(directory, candidate);
    const within = (folder: string) => paths.isWithin(path, folder);
    // Its working folder, the home folder, holds secrets of its own.
    if (this.rules.workstation) return secrets.find(within);
    if ([workingFolder, ...readableFolders].some(within)) return undefined;
    const secret = secrets.find(within);
    if (secret !== undefined || cloneFolders.some(within)) return secret;
    return officeFiles.find(within);
  }

  /** The word with `~` and the session's variables replaced by what they hold. */
  expand(word: string): string {
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
