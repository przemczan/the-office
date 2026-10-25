export interface Shell {
  /** For messages, such as `cmd.exe` or `sh`. */
  readonly name: string;
  /** How to run one command line in this shell, as the file, arguments and option to spawn it with. */
  invocation(commandLine: string): ShellInvocation;
}

export interface ShellInvocation {
  readonly file: string;
  readonly arguments: readonly string[];
  /** Node's spawn option of the same name: cmd.exe parses its own command line, which Node's quoting would break. */
  readonly windowsVerbatimArguments: boolean;
}
