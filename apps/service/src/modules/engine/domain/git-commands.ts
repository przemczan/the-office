import { programName } from "./shell-commands.js";

/** The git commands an Agent may run: they read and change nothing (spec §6). */
export const READ_ONLY_GIT_COMMANDS: readonly string[] = ["status", "diff", "log", "show"];

/** git's own options that take a value as the next word. */
const GIT_OPTIONS_WITH_VALUE: ReadonlySet<string> = new Set([
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--attr-source",
  "--list-cmds",
]);

/**
 * Options that set git's config or the programs it runs, which can make a reading command run
 * anything or write: `-c`, `--config-env`, `--exec-path`.
 */
const CONFIG_OPTION = /^(-c|--config-env|--exec-path)/;

/** `diff`, `log` and `show` write to a file with it. */
const OUTPUT_OPTION = /^--output(=|$)/;

export function isGit(programWords: readonly string[]): boolean {
  return programName(programWords[0] ?? "") === "git";
}

/**
 * What a git command line changes, in a few words, or undefined when it only reads: a git
 * command other than status, diff, log and show, or one that sets config or writes a file.
 * git alone, or with only its own options such as `--version`, reads.
 */
export function gitChange(programWords: readonly string[]): string | undefined {
  let index = 1;
  for (; index < programWords.length; index++) {
    const word = programWords[index] ?? "";
    if (!word.startsWith("-")) break;
    if (CONFIG_OPTION.test(word)) return `git ${word.split("=")[0] ?? word}`;
    if (GIT_OPTIONS_WITH_VALUE.has(word)) index++;
  }
  const command = programWords[index];
  if (command === undefined) return undefined;
  if (!READ_ONLY_GIT_COMMANDS.includes(command)) return `git ${command}`;
  const output = programWords.slice(index + 1).find((word) => OUTPUT_OPTION.test(word));
  return output === undefined ? undefined : `git ${command} --output`;
}
