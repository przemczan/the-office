import {
  programName,
  programWords,
  type ShellDialect,
  type SimpleCommand,
} from "./shell-commands.js";

/** Where a command moves the shell: nowhere, to a path as written, home, or somewhere unreadable. */
export type DirectoryChange =
  | { readonly kind: "none" }
  | { readonly kind: "to"; readonly path: string }
  | { readonly kind: "home" }
  | { readonly kind: "unknown" };

/** The programs that change the shell's directory, by their names in lower case. */
const CHANGERS: Readonly<Record<ShellDialect, ReadonlySet<string>>> = {
  bash: new Set(["cd", "pushd"]),
  powershell: new Set(["cd", "chdir", "sl", "set-location", "pushd", "push-location"]),
};

/** PowerShell's parameters that name the folder to go to. */
const POWERSHELL_PATH_PARAMETERS: ReadonlySet<string> = new Set(["-path", "-literalpath"]);

/** PowerShell's parameters that take a value which is not the folder. */
const POWERSHELL_VALUE_PARAMETERS: ReadonlySet<string> = new Set(["-stackname"]);

/** Where the command moves the shell, as far as its words tell. */
export function directoryChange(command: SimpleCommand, dialect: ShellDialect): DirectoryChange {
  const [program, ...words] = programWords(command, dialect);
  const changesDirectory = program !== undefined && CHANGERS[dialect].has(programName(program));
  if (!changesDirectory) return { kind: "none" };
  const path = dialect === "powershell" ? powerShellPath(words) : bashPath(words);
  if (path === undefined) return dialect === "bash" ? { kind: "home" } : { kind: "unknown" };
  // `cd -` goes back to wherever the shell was before, which a reading doesn't follow.
  return path === "-" ? { kind: "unknown" } : { kind: "to", path };
}

function bashPath(words: readonly string[]): string | undefined {
  const operands = words.slice(words[0] === "--" ? 1 : 0);
  return operands.find((word) => word === "-" || !word.startsWith("-"));
}

function powerShellPath(words: readonly string[]): string | undefined {
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    const parameter = word.toLowerCase();
    if (POWERSHELL_PATH_PARAMETERS.has(parameter)) return words[index + 1];
    if (POWERSHELL_VALUE_PARAMETERS.has(parameter)) index++;
    else if (!word.startsWith("-")) return word;
  }
  return undefined;
}
