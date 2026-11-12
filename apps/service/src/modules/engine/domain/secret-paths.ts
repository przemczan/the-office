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

  /**
   * The secret a candidate names by its names from the home folder, wherever they appear in it.
   * What follows them is read inside the secret, `..` and all, to tell an open folder in it.
   */
  private byHomeTail(candidate: string): string | undefined {
    const { paths } = this.rules;
    const names = paths.names(candidate);
    return this.homeTails.find((tail) =>
      startsOf(names, tail.names).some((start) => {
        const rest = names.slice(start + tail.names.length);
        return !this.isOpenInSecret(paths.resolve(tail.secret, rest.join("/")), tail.secret);
      }),
    )?.secret;
  }

  private byPath(candidate: string, directory: string): string | undefined {
    const { paths, workingFolder, readableFolders, officeFiles, cloneFolders } = this.rules;
    const path = paths.resolve(directory, candidate);
    const within = (folder: string) => paths.isWithin(path, folder);
    const secret = this.rules.secrets.find(
      (folder) => within(folder) && !this.isOpenInSecret(path, folder),
    );
    // Its working folder, the home folder, holds secrets of its own.
    if (this.rules.workstation) return secret;
    if ([workingFolder, ...readableFolders].some(within)) return undefined;
    if (secret !== undefined || cloneFolders.some(within)) return secret;
    return officeFiles.find(within);
  }

  /** Whether the absolute `path`, inside `secret`, is in a folder open in one of its children. */
  private isOpenInSecret(path: string, secret: string): boolean {
    const { paths } = this.rules;
    const depth = paths.names(secret).length;
    const names = paths.names(path);
    return this.rules.readableInSecrets.some(
      (readable) =>
        readable.secret === secret &&
        paths.isWithin(path, secret) &&
        names.length > depth + 1 &&
        names[depth + 1] === paths.names(readable.folder)[0],
    );
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

/** Each index at which `part` appears in `names` as consecutive names. */
function startsOf(names: readonly string[], part: readonly string[]): number[] {
  return names.flatMap((_, start) =>
    part.every((name, offset) => names[start + offset] === name) ? [start] : [],
  );
}
