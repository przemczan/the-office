import { isAbsolute, resolve } from "node:path";

/** The variable naming the file the `engine.api-key-sign-in` check reads its Anthropic API key from. */
export const API_KEY_FILE_VARIABLE = "ENGINE_CHECK_API_KEY_FILE";

/** Where The Office keeps an engine's Anthropic API key, in the engine's config folder. */
export const API_KEY_FILE = ".anthropic-api-key";

/** Node's `-e` code that prints the file its first argument names; `fs` is a global there. */
const PRINT_FILE = "process.stdout.write(fs.readFileSync(process.argv[1]))";

/**
 * The session settings' `apiKeyHelper` The Office writes for an engine an API key signs in: a command
 * that prints the key file with the Node it runs on, each word quoted for the shell the binary runs
 * its helper in (sh on Linux, Git Bash on Windows). It names the file, never the key. The service's
 * own (`printFileCommand` in its platform layer) is out of the tool's reach, so this is its copy.
 */
export function printFileCommand(
  file: string,
  platform: NodeJS.Platform = process.platform,
  node: string = process.execPath,
): string {
  const quote = platform === "win32" ? doubleQuoted : shQuoted;
  return [node, "-e", PRINT_FILE, file].map(quote).join(" ");
}

/** A word in POSIX sh's single quotes, where nothing but a single quote is special. */
function shQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** A word in double quotes, which cmd.exe and Git Bash alike read as one word. */
function doubleQuoted(word: string): string {
  return `"${word}"`;
}

/** The key file the run names, or why the check is skipped without one. */
export type ApiKeyFileChoice = { readonly file: string } | { readonly skipped: string };

/**
 * The key file from `ENGINE_CHECK_API_KEY_FILE`, a relative path taken from where npm was run
 * (`INIT_CWD`); without it the check is skipped, saying how to run it.
 */
export function apiKeyFileFrom(
  environment: NodeJS.ProcessEnv,
  workingFolder: string = process.cwd(),
): ApiKeyFileChoice {
  const given = environment[API_KEY_FILE_VARIABLE]?.trim();
  if (given === undefined || given === "") {
    return {
      skipped: `No API key: name a file holding an Anthropic API key in ${API_KEY_FILE_VARIABLE} to run it`,
    };
  }
  return {
    file: isAbsolute(given) ? given : resolve(environment["INIT_CWD"] ?? workingFolder, given),
  };
}

/** How long a run of the key's characters must be to count as a part of it. */
const PART_LENGTH = 8;

/** The prefix every Anthropic API key starts with, which names no key (`sk-ant-api03-`). */
const KEY_PREFIX = /^sk-ant-[a-z0-9]+-/i;

/**
 * Whether `text` holds the key or any run of `PART_LENGTH` of its characters past the prefix every
 * key shares, so a key cut or wrapped in an output still shows.
 */
export function holdsPartOf(text: string, key: string): boolean {
  const secret = key.replace(KEY_PREFIX, "");
  if (secret.length === 0) return false;
  if (secret.length <= PART_LENGTH) return text.includes(secret);
  for (let start = 0; start + PART_LENGTH <= secret.length; start++) {
    if (text.includes(secret.slice(start, start + PART_LENGTH))) return true;
  }
  return false;
}

export const REDACTED = "[redacted: holds part of the API key]";

/**
 * `value` with every string that holds part of the key (`holdsPartOf`) replaced by `REDACTED`, keys of
 * objects too, so nothing the report keeps holds it.
 */
export function redactKey<T>(value: T, key: string): T {
  return redact(value, key) as T;
}

function redact(value: unknown, key: string): unknown {
  if (typeof value === "string") return holdsPartOf(value, key) ? REDACTED : value;
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [redact(name, key), redact(item, key)]),
    );
  }
  return value;
}

/** Replaces each item of `items` by its redacted copy, so a session's records lose the key in place. */
export function redactKeyInPlace<T>(items: T[], key: string): void {
  for (let index = 0; index < items.length; index++) {
    items[index] = redactKey(items[index] as T, key);
  }
}

/** The names of the variables `env` printed that start with one of `prefixes`, each once, sorted. */
export function variableNames(envOutput: string, prefixes: readonly string[]): string[] {
  const names = envOutput
    .split(/\r?\n/)
    .map((line) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1])
    .filter(
      (name): name is string =>
        name !== undefined &&
        prefixes.some((prefix) => name.toUpperCase().startsWith(prefix.toUpperCase())),
    );
  return [...new Set(names)].toSorted();
}
