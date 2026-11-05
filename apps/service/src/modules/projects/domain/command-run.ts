/** How a Project command ended. */
export type CommandOutcome =
  | "passed"
  | /** It exited with a code other than 0. */ "failed"
  | /** The shell could not run it at all, as when its program isn't installed. */ "could-not-run"
  | /** It ran out of time and was ended, with everything it started. */ "timed-out"
  | /** The Office stopped it, with everything it started. */ "stopped";

/** A Project command The Office ran, as it is recorded. */
export interface CommandRun {
  readonly commandLine: string;
  readonly outcome: CommandOutcome;
  /** Undefined when it never exited by itself. */
  readonly exitCode: number | undefined;
  readonly durationMs: number;
  /** What it printed, filtered by filteredOutput. */
  readonly output: string;
  /** What it printed for the user to read, as wholeOutputOf keeps it. */
  readonly wholeOutput: string;
}

const OUTPUT_LIMIT = 6000;
const WHOLE_OUTPUT_LIMIT_BYTES = 64 * 1024;
const CONTEXT_LINES = 3;
const TAIL_LINES = 30;

// Words common test runners, compilers and package managers print on a failure, in any language.
const FAILURE_MARKER =
  /\b(fail(ed|ure|ing)?|errors?|exception|assert(ion)?|expected|traceback|panic(ked)?|undefined reference|cannot find|not found)\b|✗|✘|×/i;

// oxlint-disable-next-line no-control-regex -- the escape character is what it matches
const TERMINAL_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * A command's output cut to what tells why it failed (spec §2.3): each line with a failure marker
 * and the lines around it, then the last lines, which hold a run's summary. Lines left out are
 * counted, and a result still too long keeps its end. No rules per language or tool.
 */
export function filteredOutput(output: string): string {
  const lines = output.replace(TERMINAL_ESCAPE, "").trimEnd().split(/\r?\n/);
  const kept = new Set<number>();
  lines.forEach((line, index) => {
    if (!FAILURE_MARKER.test(line)) return;
    for (let near = index - CONTEXT_LINES; near <= index + CONTEXT_LINES; near++) kept.add(near);
  });
  for (let index = lines.length - TAIL_LINES; index < lines.length; index++) kept.add(index);
  const indexes = [...kept]
    .filter((index) => index >= 0 && index < lines.length)
    .toSorted((one, other) => one - other);
  return keptEnd(withGapsCounted(lines, indexes).join("\n"));
}

function withGapsCounted(lines: readonly string[], indexes: readonly number[]): string[] {
  const shown: string[] = [];
  let previous = -1;
  for (const index of indexes) {
    const gap = index - previous - 1;
    if (gap > 0) shown.push(`… ${gap} ${gap === 1 ? "line" : "lines"} left out`);
    shown.push(lines[index] ?? "");
    previous = index;
  }
  return shown;
}

function keptEnd(text: string): string {
  return text.length <= OUTPUT_LIMIT ? text : `… the start left out\n${text.slice(-OUTPUT_LIMIT)}`;
}

/**
 * The last 64 KB of what a command printed, for the Stage history (spec §4), under a line saying
 * how much was cut. `droppedBytes` counts what never reached `printed`. Nothing is filtered but
 * colours, and the NUL characters Postgres can't store.
 */
export function wholeOutputOf(printed: string, droppedBytes: number): string {
  const bytes = new TextEncoder().encode(
    printed.replace(TERMINAL_ESCAPE, "").replaceAll("\0", "").replaceAll("\r\n", "\n").trimEnd(),
  );
  const start = characterStartFrom(bytes, Math.max(0, bytes.length - WHOLE_OUTPUT_LIMIT_BYTES));
  const kept = new TextDecoder().decode(bytes.subarray(start));
  const cutBytes = droppedBytes + start;
  return cutBytes === 0 ? kept : `… ${sizeInWords(cutBytes)} cut from the start\n${kept}`;
}

/** The first byte at or after `index` that starts a UTF-8 character, not one inside it. */
function characterStartFrom(bytes: Uint8Array, index: number): number {
  let start = index;
  while (((bytes[start] ?? 0) & 0b1100_0000) === 0b1000_0000) start++;
  return start;
}

function sizeInWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
