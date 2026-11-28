import { programName } from "./shell-commands.js";

/**
 * The programs that write, move, remove or change every file they name, in Bash and in
 * PowerShell (cmdlets and their aliases, cmd.exe's own): each operand may be one. A program that
 * copies is here whole, so the source of a copy reads as written too: the Read tool reads a
 * protected file instead.
 */
const WRITING_PROGRAMS: ReadonlySet<string> = new Set([
  // Bash and the coreutils.
  "chgrp",
  "chmod",
  "chown",
  "cp",
  "dd",
  "install",
  "ln",
  "mkdir",
  "mv",
  "rm",
  "rmdir",
  "rsync",
  "shred",
  "tee",
  "touch",
  "truncate",
  "unlink",
  // PowerShell's cmdlets and their aliases, and cmd.exe's.
  "ac",
  "add-content",
  "clc",
  "clear-content",
  "copy",
  "copy-item",
  "cpi",
  "del",
  "erase",
  "md",
  "mi",
  "move",
  "move-item",
  "new-item",
  "ni",
  "out-file",
  "rd",
  "ren",
  "rename",
  "rename-item",
  "ri",
  "rni",
  "remove-item",
  "sc",
  "set-content",
  "set-item",
  "si",
  "tee-object",
  "xcopy",
]);

/** The programs that change the files they name only with their in-place option, as `sed -i`. */
const IN_PLACE_PROGRAMS: ReadonlySet<string> = new Set(["sed", "perl"]);

/** `-i`, `-i.bak`, `-pi`, `--in-place` and `--in-place=.bak`: `i` among the short options. */
const IN_PLACE_OPTION = /^(-[A-Za-z]*i|--in-place(=|$))/;

/**
 * The options and operands naming a written path within the word, as `--target-directory=x`,
 * dd's `of=x` and PowerShell's `-Path:x`; another's value, such as rsync's `--exclude=.git`,
 * names no path written.
 */
const PATH_VALUED = /^(--target-directory=|of=|-(path|literalpath|destination|filepath):)/i;

/**
 * The words a command may write a file at, by its program (`programWords`): every operand of a
 * writing program, and the path a word such as `--target-directory=x` names; none for any other
 * program. Options themselves are left out.
 */
export function writtenPaths(programWords: readonly string[]): readonly string[] {
  const [program, ...words] = programWords;
  const name = programName(program ?? "");
  const writes =
    WRITING_PROGRAMS.has(name) ||
    (IN_PLACE_PROGRAMS.has(name) && words.some((word) => IN_PLACE_OPTION.test(word)));
  if (!writes) return [];
  return words.flatMap((word) => {
    const valued = PATH_VALUED.exec(word);
    if (valued !== null) return [word.slice(valued[0].length)];
    return word.startsWith("-") ? [] : [word];
  });
}
