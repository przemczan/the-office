/** The language of a command line an Agent runs: Bash, or PowerShell on Windows (spec §6). */
export type ShellDialect = "bash" | "powershell";

export interface Redirect {
  readonly target: string;
  /** Whether the command writes to the target rather than reads it. */
  readonly writes: boolean;
}

/** One command of a command line: a program and its arguments, with where its streams go. */
export interface SimpleCommand {
  /** As the shell passes them on: quotes removed, escapes applied, variables not expanded. */
  readonly words: readonly string[];
  readonly redirects: readonly Redirect[];
}

/** A command line The Office can't read well enough to judge, such as an encoded PowerShell command. */
export class UnreadableCommand extends Error {
  constructor(readonly reason: string) {
    super(`The command can't be read: ${reason}.`);
    this.name = "UnreadableCommand";
  }
}

/** Deeper than any command line written by hand; a deeper one is refused rather than read on. */
const MAXIMUM_NESTING = 8;

/**
 * Every simple command a command line runs, in no particular order: those of its lists and
 * pipelines, those in command and process substitutions, subshells and script blocks, and the
 * scripts it hands to another shell (`bash -c`, `eval`, `cmd /c`, `pwsh -Command`,
 * `Invoke-Expression`). A good reading, not a shell: what it can't see, such as a command held in a
 * variable, an alias, or a script fed to a shell on its standard input, runs unjudged, which the
 * threat model of spec §6 accepts and the HEAD and branch check after each Stage backs.
 * Throws `UnreadableCommand`.
 */
export function simpleCommands(commandLine: string, dialect: ShellDialect): SimpleCommand[] {
  return readCommands(commandLine, dialect, 0);
}

function readCommands(text: string, dialect: ShellDialect, depth: number): SimpleCommand[] {
  if (depth > MAXIMUM_NESTING) throw new UnreadableCommand("it nests scripts too deeply");
  const reader = new CommandReader(text, dialect);
  reader.readList(undefined);
  return reader.commands.flatMap((command) => [
    command,
    ...nestedScript(command, dialect).flatMap((script) =>
      readCommands(script.text, script.dialect, depth + 1),
    ),
  ]);
}

/**
 * The program a command runs, and its arguments: its words after variable assignments, reserved
 * words and the programs that only run another (`env`, `sudo`, `xargs`, `Start-Process`, ...).
 */
export function programWords(command: SimpleCommand, dialect: ShellDialect): readonly string[] {
  let words = command.words;
  for (;;) {
    const first = words[0];
    if (first === undefined) return words;
    if (RESERVED_WORDS.has(first) || (dialect === "bash" && ASSIGNMENT.test(first))) {
      words = words.slice(1);
      continue;
    }
    const wrapped = dialect === "powershell" ? startedProcess(words) : unwrapped(words);
    if (wrapped === undefined) return words;
    words = wrapped;
  }
}

/** A program's name as a word names it: without folders, in lower case, without `.exe`. */
export function programName(word: string): string {
  return (
    word
      .split(/[\\/]/)
      .at(-1)
      ?.toLowerCase()
      .replace(/\.(exe|cmd|bat|com)$/, "") ?? ""
  );
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/** Words that open or close a compound command; what follows them runs as a command. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  "!",
  "{",
  "}",
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "while",
  "until",
  "do",
  "done",
  "&",
  ".",
]);

/** The options of each wrapper that take a value, so the value is not read as the program. */
const WRAPPERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["env", new Set(["-u", "--unset", "-C", "--chdir"])],
  ["command", new Set<string>()],
  ["builtin", new Set<string>()],
  ["exec", new Set(["-a"])],
  ["nohup", new Set<string>()],
  ["time", new Set(["-f", "--format", "-o", "--output"])],
  ["nice", new Set(["-n", "--adjustment"])],
  ["timeout", new Set(["-s", "--signal", "-k", "--kill-after"])],
  [
    "sudo",
    new Set([
      "-u",
      "--user",
      "-g",
      "--group",
      "-h",
      "--host",
      "-p",
      "--prompt",
      "-C",
      "-D",
      "-r",
      "-t",
      "-U",
    ]),
  ],
  ["doas", new Set(["-u", "-C"])],
  ["setsid", new Set<string>()],
  ["stdbuf", new Set(["-i", "-o", "-e"])],
  [
    "xargs",
    new Set([
      "-a",
      "-d",
      "-E",
      "-e",
      "-I",
      "-i",
      "-L",
      "-l",
      "-n",
      "-P",
      "-s",
      "--arg-file",
      "--delimiter",
      "--max-args",
      "--max-procs",
      "--max-chars",
      "--replace",
    ]),
  ],
]);

/** The words of the program a wrapper runs, or undefined when `words` runs no wrapper. */
function unwrapped(words: readonly string[]): readonly string[] | undefined {
  const name = programName(words[0] ?? "");
  const optionsWithValue = WRAPPERS.get(name);
  if (optionsWithValue === undefined) return undefined;
  let index = 1;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--") {
      index++;
      break;
    }
    if (word.startsWith("-")) {
      index += optionsWithValue.has(word) ? 2 : 1;
    } else if (name === "env" && ASSIGNMENT.test(word)) {
      index++;
    } else {
      break;
    }
  }
  // timeout's first operand is its duration.
  if (name === "timeout") index++;
  return words.slice(index);
}

/** PowerShell's `Start-Process`: the program it starts and its arguments, or undefined for any other command. */
function startedProcess(words: readonly string[]): readonly string[] | undefined {
  const name = programName(words[0] ?? "");
  if (name !== "start-process" && name !== "saps" && name !== "start") return undefined;
  let file: string | undefined;
  const argumentWords: string[] = [];
  for (let index = 1; index < words.length; index++) {
    const word = words[index] ?? "";
    const parameter = word.toLowerCase();
    if (parameter === "-filepath" || parameter === "-file") {
      file = words[++index];
    } else if (parameter === "-argumentlist" || parameter === "-args") {
      argumentWords.push(...(words[++index] ?? "").split(/[\s,]+/).filter(Boolean));
    } else if (word.startsWith("-")) {
      index++;
    } else if (file === undefined) {
      file = word;
    } else {
      argumentWords.push(...word.split(/[\s,]+/).filter(Boolean));
    }
  }
  return file === undefined ? [] : [file, ...argumentWords];
}

interface Script {
  readonly text: string;
  readonly dialect: ShellDialect;
}

const POSIX_SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);

/** The scripts a command hands to a shell to read, which run as commands of their own. */
function nestedScript(command: SimpleCommand, dialect: ShellDialect): Script[] {
  const words = programWords(command, dialect);
  const name = programName(words[0] ?? "");
  const rest = words.slice(1);
  if (POSIX_SHELLS.has(name)) {
    const option = rest.findIndex((word) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word));
    const script = option === -1 ? undefined : rest[option + 1];
    return script === undefined ? [] : [{ text: script, dialect: "bash" }];
  }
  if (name === "eval" && dialect === "bash") return [{ text: rest.join(" "), dialect: "bash" }];
  if (name === "cmd") {
    const option = rest.findIndex((word) => /^\/[ck]$/i.test(word));
    // cmd.exe splits a line at & && || | as Bash does, which is all a reading here needs.
    return option === -1 ? [] : [{ text: rest.slice(option + 1).join(" "), dialect: "bash" }];
  }
  if (name === "powershell" || name === "pwsh") return powerShellScript(rest);
  if (dialect === "powershell" && (name === "invoke-expression" || name === "iex")) {
    return [{ text: rest.filter((word) => !/^-command$/i.test(word)).join(" "), dialect }];
  }
  return [];
}

/** The script of a `powershell` or `pwsh` command line, by its parameters, which it takes abbreviated. */
function powerShellScript(parameters: readonly string[]): Script[] {
  for (let index = 0; index < parameters.length; index++) {
    const word = (parameters[index] ?? "").toLowerCase();
    if (!word.startsWith("-")) {
      return [{ text: parameters.slice(index).join(" "), dialect: "powershell" }];
    }
    const name = word.slice(1);
    if (
      name === "ec" ||
      (name.length > 0 && "encodedcommand".startsWith(name) && name.startsWith("e"))
    ) {
      throw new UnreadableCommand("PowerShell's -EncodedCommand hides the command it runs");
    }
    if (name.length > 0 && "command".startsWith(name)) {
      return [{ text: parameters.slice(index + 1).join(" "), dialect: "powershell" }];
    }
    if (name.length > 0 && "file".startsWith(name)) return [];
    if (POWERSHELL_PARAMETERS_WITH_VALUE.has(name)) index++;
  }
  return [];
}

const POWERSHELL_PARAMETERS_WITH_VALUE: ReadonlySet<string> = new Set([
  "executionpolicy",
  "ep",
  "workingdirectory",
  "wd",
  "windowstyle",
  "w",
  "outputformat",
  "of",
  "inputformat",
  "if",
  "configurationname",
  "settingsfile",
  "version",
  "v",
]);

/** Reads one command line of one dialect into simple commands. */
class CommandReader {
  readonly commands: SimpleCommand[] = [];
  private position = 0;
  /** Bash here-documents whose bodies begin after the current line. */
  private readonly pendingHereDocuments: { delimiter: string; stripsTabs: boolean }[] = [];

  constructor(
    private readonly text: string,
    private readonly dialect: ShellDialect,
  ) {}

  /** Reads commands up to `closing`, which it consumes, or to the end. */
  readList(closing: string | undefined): void {
    let words: string[] = [];
    let redirects: Redirect[] = [];
    const finish = (): void => {
      if (words.length > 0 || redirects.length > 0) this.commands.push({ words, redirects });
      words = [];
      redirects = [];
    };
    while (this.position < this.text.length) {
      this.skipBlanks();
      if (this.position >= this.text.length) break;
      if (closing !== undefined && this.startsWith(closing)) {
        this.position += closing.length;
        finish();
        return;
      }
      const separator = this.separatorLength();
      if (separator > 0) {
        const newline = this.text[this.position] === "\n";
        this.position += separator;
        finish();
        if (newline) this.skipHereDocuments();
        continue;
      }
      if (this.atComment()) {
        this.skipComment();
        continue;
      }
      if (this.startsWith("(") || (this.dialect === "powershell" && this.startsWith("{"))) {
        finish();
        const nestedClosing = this.text[this.position] === "(" ? ")" : "}";
        this.position++;
        this.readList(nestedClosing);
        continue;
      }
      if (this.startsWith(")") || this.startsWith("}")) {
        // A closing bracket without its opening: the shell would refuse the line, so it runs nothing.
        this.position++;
        finish();
        continue;
      }
      const redirect = this.readRedirect();
      if (redirect !== undefined) {
        if (redirect.target !== "") redirects.push(redirect);
        continue;
      }
      const start = this.position;
      const word = this.readWord();
      if (this.position === start) {
        // A character no rule above reads; skipping it keeps the reading going.
        this.position++;
      } else {
        words.push(word);
      }
    }
    finish();
  }

  /**
   * The length of the operator ending a command here, or 0. PowerShell's & before a command calls
   * it, which reads the same: what follows is a command.
   */
  private separatorLength(): number {
    if (this.startsWith("&>")) return 0;
    for (const operator of ["&&", "||", "|&", ";;"]) {
      if (this.startsWith(operator)) return operator.length;
    }
    const character = this.text[this.position];
    return character !== undefined && "\n;|&".includes(character) ? 1 : 0;
  }

  private atComment(): boolean {
    return (
      this.text[this.position] === "#" || (this.dialect === "powershell" && this.startsWith("<#"))
    );
  }

  private skipComment(): void {
    if (this.startsWith("<#")) {
      const end = this.text.indexOf("#>", this.position + 2);
      this.position = end === -1 ? this.text.length : end + 2;
      return;
    }
    const end = this.text.indexOf("\n", this.position);
    this.position = end === -1 ? this.text.length : end;
  }

  private skipBlanks(): void {
    for (;;) {
      const character = this.text[this.position];
      if (character === " " || character === "\t" || character === "\r") {
        this.position++;
      } else if (this.continuesLine()) {
        this.position += 2;
      } else {
        return;
      }
    }
  }

  /** A line continuation: Bash's backslash, PowerShell's backtick, before a newline. */
  private continuesLine(): boolean {
    const escape = this.dialect === "bash" ? "\\" : "`";
    return this.startsWith(`${escape}\n`) || this.startsWith(`${escape}\r\n`);
  }

  private readRedirect(): Redirect | undefined {
    const match = (this.dialect === "bash" ? BASH_REDIRECT : POWERSHELL_REDIRECT).exec(
      this.text.slice(this.position),
    );
    // A process substitution begins like a redirect; it is a word holding commands.
    if (match === null || this.startsWith("<(") || this.startsWith(">(")) return undefined;
    const operator = match[0];
    this.position += operator.length;
    this.skipBlanks();
    if (operator.endsWith("&") && /^\d|^-/.test(this.text.slice(this.position))) {
      this.readWord();
      return { target: "", writes: false };
    }
    if (this.dialect === "bash" && /<<-?$/.test(operator)) {
      const delimiter = this.readWord();
      this.pendingHereDocuments.push({ delimiter, stripsTabs: operator.endsWith("-") });
      return { target: "", writes: false };
    }
    const target = this.readWord();
    return { target: operator.endsWith("<<<") ? "" : target, writes: operator.includes(">") };
  }

  private skipHereDocuments(): void {
    for (const { delimiter, stripsTabs } of this.pendingHereDocuments.splice(0)) {
      for (;;) {
        if (this.position >= this.text.length) return;
        const end = this.text.indexOf("\n", this.position);
        const lineEnd = end === -1 ? this.text.length : end;
        const line = this.text.slice(this.position, lineEnd).replace(/\r$/, "");
        this.position = end === -1 ? this.text.length : end + 1;
        if ((stripsTabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
      }
    }
  }

  private readWord(): string {
    let word = "";
    while (this.position < this.text.length) {
      if (this.continuesLine()) {
        this.position += 2;
        continue;
      }
      const character = this.text[this.position] ?? "";
      if (this.endsWord(character)) break;
      word += this.dialect === "bash" ? this.readBashPart() : this.readPowerShellPart();
    }
    return word;
  }

  private endsWord(character: string): boolean {
    if (this.dialect === "bash" && (this.startsWith("<(") || this.startsWith(">("))) return false;
    if (/\s/.test(character) || ";|&()".includes(character)) return true;
    return (this.dialect === "bash" ? "<>" : "{}>").includes(character);
  }

  /** One part of a Bash word, its text as the shell passes it on. */
  private readBashPart(): string {
    if (this.startsWith("$((")) return this.readUntilClosing(3, "))");
    if (this.startsWith("$(") || this.startsWith("<(") || this.startsWith(">(")) {
      return this.readSubstitution(2, ")");
    }
    if (this.startsWith("${")) return this.readUntilClosing(2, "}");
    const character = this.text[this.position] ?? "";
    this.position++;
    switch (character) {
      case "\\":
        return this.text[this.position++] ?? "";
      case "'":
        return this.readUntil("'");
      case '"':
        return this.readBashDoubleQuoted();
      case "`":
        return this.readBackticks();
      default:
        return character;
    }
  }

  private readBashDoubleQuoted(): string {
    let text = "";
    while (this.position < this.text.length && this.text[this.position] !== '"') {
      if (this.startsWith("$(") && !this.startsWith("$((")) {
        text += this.readSubstitution(2, ")");
      } else if (this.startsWith("\\") && '"\\$`\n'.includes(this.text[this.position + 1] ?? "")) {
        text += this.text[this.position + 1];
        this.position += 2;
      } else if (this.startsWith("`")) {
        this.position++;
        text += this.readBackticks();
      } else {
        text += this.text[this.position++];
      }
    }
    this.position++;
    return text;
  }

  private readBackticks(): string {
    const start = this.position;
    let script = "";
    while (this.position < this.text.length && this.text[this.position] !== "`") {
      if (this.startsWith("\\`")) {
        script += "`";
        this.position += 2;
      } else {
        script += this.text[this.position++];
      }
    }
    this.position++;
    this.commands.push(...readCommandsWithin(script, this.dialect));
    return this.text.slice(start - 1, this.position);
  }

  /** One part of a PowerShell word, its text as PowerShell passes it on. */
  private readPowerShellPart(): string {
    if (this.startsWith("$(") || this.startsWith("@(")) return this.readSubstitution(2, ")");
    if (this.startsWith("@'\n") || this.startsWith("@'\r\n")) return this.readHereString("'@");
    if (this.startsWith('@"\n') || this.startsWith('@"\r\n')) return this.readHereString('"@');
    const character = this.text[this.position] ?? "";
    this.position++;
    switch (character) {
      case "`":
        return this.text[this.position++] ?? "";
      case "'":
        return this.readPowerShellSingleQuoted();
      case '"':
        return this.readPowerShellDoubleQuoted();
      default:
        return character;
    }
  }

  private readPowerShellSingleQuoted(): string {
    let text = "";
    while (this.position < this.text.length) {
      if (this.startsWith("''")) {
        text += "'";
        this.position += 2;
      } else if (this.text[this.position] === "'") {
        this.position++;
        return text;
      } else {
        text += this.text[this.position++];
      }
    }
    return text;
  }

  private readPowerShellDoubleQuoted(): string {
    let text = "";
    while (this.position < this.text.length) {
      if (this.startsWith('""')) {
        text += '"';
        this.position += 2;
      } else if (this.text[this.position] === '"') {
        this.position++;
        return text;
      } else if (this.startsWith("$(")) {
        text += this.readSubstitution(2, ")");
      } else if (this.text[this.position] === "`") {
        text += this.text[this.position + 1] ?? "";
        this.position += 2;
      } else {
        text += this.text[this.position++];
      }
    }
    return text;
  }

  private readHereString(closing: string): string {
    const start = this.text.indexOf("\n", this.position) + 1;
    const end = this.text.indexOf(`\n${closing}`, start);
    this.position = end === -1 ? this.text.length : end + 1 + closing.length;
    return this.text.slice(start, end === -1 ? this.text.length : end);
  }

  /** A substitution's commands, read where they stand; its text stays in the word as written. */
  private readSubstitution(opening: number, closing: string): string {
    const start = this.position;
    this.position += opening;
    this.readList(closing);
    return this.text.slice(start, this.position);
  }

  private readUntilClosing(opening: number, closing: string): string {
    const start = this.position;
    const end = this.text.indexOf(closing, start + opening);
    this.position = end === -1 ? this.text.length : end + closing.length;
    return this.text.slice(start, this.position);
  }

  private readUntil(closing: string): string {
    const end = this.text.indexOf(closing, this.position);
    const text = this.text.slice(this.position, end === -1 ? this.text.length : end);
    this.position = end === -1 ? this.text.length : end + 1;
    return text;
  }

  private startsWith(text: string, offset = 0): boolean {
    return this.text.startsWith(text, this.position + offset);
  }
}

/** The commands of a script inside a word, such as backticks, read in the same dialect. */
function readCommandsWithin(script: string, dialect: ShellDialect): SimpleCommand[] {
  const reader = new CommandReader(script, dialect);
  reader.readList(undefined);
  return reader.commands;
}

/** `>`, `>>`, `>|`, `&>`, `&>>`, `<`, `<<`, `<<-`, `<<<`, `<>`, each optionally after a stream number, and `>&`/`<&` duplications. */
const BASH_REDIRECT = /^(\d*(>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)|&>>|&>)/;

/** `>`, `>>` and `>&`, each optionally after a stream number or `*`. */
const POWERSHELL_REDIRECT = /^[\d*]?(>>|>&|>)/;
