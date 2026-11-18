/** Node's `-e` code that prints the file its first argument names; `fs` is a global there. */
const PRINT_FILE = "process.stdout.write(fs.readFileSync(process.argv[1]))";

/**
 * A command line that prints a file's bytes with the Node The Office runs on, each word quoted by
 * `quote` for the shell that runs it. It names the file, never what the file holds.
 */
export function printFileCommand(quote: (word: string) => string, file: string): string {
  return [process.execPath, "-e", PRINT_FILE, file].map(quote).join(" ");
}

/** A word in POSIX sh's single quotes, where nothing but a single quote is special. */
export function shQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * A word in double quotes, which cmd.exe and Git Bash alike read as one word: a Windows path holds
 * no double quote, and the backslashes before its letters stay as they are in Git Bash.
 */
export function doubleQuoted(word: string): string {
  return `"${word}"`;
}
