/** How many lines a slice gives when the reader names no number. */
export const DEFAULT_LINE_COUNT = 300;

/** The most lines one slice gives; the answer's budget usually stops it sooner. */
export const MAX_LINE_COUNT = 1_000;

/** How many lines a search shows before and after each match when the reader names no number. */
export const DEFAULT_CONTEXT_LINES = 2;

/** The most lines a search shows before and after each match. */
export const MAX_CONTEXT_LINES = 10;

/**
 * How a document is read, by its lines, counting from 1: a slice of them, or a search for a
 * phrase in them from a line on. Both number lines the same way, so a match's line starts a slice
 * at that line.
 */
export type DocumentReading =
  | { readonly kind: "slice"; readonly fromLine: number; readonly lineCount: number }
  | {
      readonly kind: "search";
      readonly phrase: string;
      readonly fromLine: number;
      readonly contextLines: number;
    };

/** What a reading of a document answers: its numbered lines, then where the document goes on. */
export interface DocumentPart {
  /** Every line the document has, not only those shown. */
  readonly lineCount: number;
  readonly text: string;
}

/** Takes a document's lines one at a time, in order, and keeps only those its answer shows. */
export interface DocumentReader {
  take(line: string): void;
  part(): DocumentPart;
}

/** Room kept in the budget for the words after the lines: where the document goes on, a cut. */
const CLOSING_ROOM = 400;

/**
 * A reader whose part stays within `budget` characters. A line that can't fit in an answer on its
 * own is cut, and the part says so.
 */
export function documentReader(reading: DocumentReading, budget: number): DocumentReader {
  const lines = new ShownLines(Math.max(budget - CLOSING_ROOM, 0));
  return reading.kind === "slice"
    ? new SliceReader(reading.fromLine, reading.lineCount, lines)
    : new SearchReader(reading.phrase, reading.fromLine, reading.contextLines, lines);
}

/** "1 line", "1,312 lines". */
export function lineCountWords(count: number): string {
  return count === 1 ? "1 line" : `${amount(count)} lines`;
}

/** The lines an answer shows, numbered, within the characters it has room for. */
class ShownLines {
  private readonly shown: string[] = [];
  private used = 0;
  private cutNote: string | undefined;

  constructor(private readonly room: number) {}

  get isEmpty(): boolean {
    return this.shown.length === 0;
  }

  /** Whether all of `lines` fit after those shown, each with its line number and mark. */
  fits(lines: readonly ShownLine[]): boolean {
    return (
      this.used + lines.reduce((total, line) => total + rendered(line).length + 1, 0) <= this.room
    );
  }

  /** Shows `lines`, which must fit. */
  add(lines: readonly ShownLine[]): void {
    for (const line of lines) {
      const text = rendered(line);
      this.shown.push(text);
      this.used += text.length + 1;
    }
  }

  /** Shows one line alone in the answer, as much of it as there is room for. */
  addCut(line: NumberedLine): void {
    const kept = Math.max(this.room - rendered({ ...line, text: "" }).length - 1, 0);
    if (line.text.length > kept) {
      this.cutNote = `Line ${line.number} is longer than one answer can hold, so it is cut: these are its first ${amount(kept)} of ${amount(line.text.length)} characters.`;
    }
    this.add([{ ...line, text: line.text.slice(0, kept) }]);
  }

  /** The lines, then the closing words and any note on a cut line. */
  text(closing: string): string {
    const words = [closing, this.cutNote].filter((part) => part !== undefined).join(" ");
    return this.isEmpty ? words : `${this.shown.join("\n")}\n\n${words}`;
  }
}

/** `→` marks a slice's line, as Read does; `:` a search's match and `-` its context, as grep does. */
type LineMark = "→" | ":" | "-";

interface NumberedLine {
  readonly number: number;
  readonly mark: LineMark;
  readonly text: string;
}

/** grep's line between groups of matches that aren't next to each other. */
const GAP = "--";

type ShownLine = NumberedLine | typeof GAP;

function rendered(line: ShownLine): string {
  return line === GAP ? GAP : `${String(line.number).padStart(6)}${line.mark}${line.text}`;
}

class SliceReader implements DocumentReader {
  private lineNumber = 0;
  private lastShown = 0;
  private stopped = false;
  /** Whether the budget, not the line count, ended the slice. */
  private full = false;

  constructor(
    private readonly fromLine: number,
    private readonly lineCount: number,
    private readonly lines: ShownLines,
  ) {}

  take(text: string): void {
    this.lineNumber += 1;
    if (this.stopped || this.lineNumber < this.fromLine) return;
    if (this.lineNumber >= this.fromLine + this.lineCount) {
      this.stopped = true;
      return;
    }
    const line: NumberedLine = { number: this.lineNumber, mark: "→", text };
    if (this.lines.fits([line])) {
      this.lines.add([line]);
    } else if (this.lines.isEmpty) {
      this.lines.addCut(line);
    } else {
      this.stopped = true;
      this.full = true;
      return;
    }
    this.lastShown = this.lineNumber;
  }

  part(): DocumentPart {
    const total = this.lineNumber;
    return { lineCount: total, text: this.lines.text(this.closing(total)) };
  }

  private closing(total: number): string {
    if (total === 0) return "The document is empty.";
    if (this.fromLine > total) {
      return `The document has ${lineCountWords(total)}; fromLine ${this.fromLine} is past its end.`;
    }
    const shown =
      this.lastShown === this.fromLine
        ? `Line ${this.fromLine} of ${amount(total)}`
        : `Lines ${this.fromLine}–${this.lastShown} of ${amount(total)}`;
    if (this.lastShown === total) return `${shown}: the end of the document.`;
    const stop = this.full ? "; one answer holds no more" : "";
    return `${shown}${stop}. Read on with fromLine ${this.lastShown + 1}.`;
  }
}

/**
 * Finds the lines holding the phrase, matched literally and whatever the case, from a line on.
 * Matches close together share their context; a gap between groups shows as `--`.
 */
class SearchReader implements DocumentReader {
  private readonly needle: string;
  private lineNumber = 0;
  /** The last lines read and not shown, for the context before the next match. */
  private before: NumberedLine[] = [];
  private afterLeft = 0;
  private lastShown = 0;
  private matchesShown = 0;
  private lastMatch = 0;
  private matchesAfter = 0;
  private stopped = false;

  constructor(
    phrase: string,
    private readonly fromLine: number,
    private readonly contextLines: number,
    private readonly lines: ShownLines,
  ) {
    this.needle = phrase.toLowerCase();
  }

  take(text: string): void {
    this.lineNumber += 1;
    if (this.lineNumber < this.fromLine) return;
    const isMatch = text.toLowerCase().includes(this.needle);
    if (this.stopped) {
      if (isMatch) this.matchesAfter += 1;
      return;
    }
    if (isMatch) this.takeMatch(text);
    else if (this.afterLeft > 0) this.takeContextAfter(text);
    else this.keepForContext(text);
  }

  part(): DocumentPart {
    const total = this.lineNumber;
    return { lineCount: total, text: this.lines.text(this.closing(total)) };
  }

  private takeMatch(text: string): void {
    const match: NumberedLine = { number: this.lineNumber, mark: ":", text };
    const group = [...this.before.filter((line) => line.number > this.lastShown), match];
    const withGap: ShownLine[] = this.isApart(group[0]?.number ?? match.number)
      ? [GAP, ...group]
      : group;
    if (this.lines.fits(withGap)) {
      this.lines.add(withGap);
    } else if (this.lines.isEmpty) {
      this.lines.addCut(match);
      this.stopped = true;
    } else {
      this.stopped = true;
      this.matchesAfter += 1;
      return;
    }
    this.matchesShown += 1;
    this.lastMatch = this.lineNumber;
    this.lastShown = this.lineNumber;
    this.before = [];
    this.afterLeft = this.contextLines;
  }

  private takeContextAfter(text: string): void {
    const line: NumberedLine = { number: this.lineNumber, mark: "-", text };
    if (!this.lines.fits([line])) {
      this.stopped = true;
      return;
    }
    this.lines.add([line]);
    this.lastShown = this.lineNumber;
    this.afterLeft -= 1;
  }

  private keepForContext(text: string): void {
    if (this.contextLines === 0) return;
    this.before.push({ number: this.lineNumber, mark: "-", text });
    if (this.before.length > this.contextLines) this.before.shift();
  }

  /** Whether a group starting at `firstLine` leaves lines unshown after the previous group. */
  private isApart(firstLine: number): boolean {
    return this.lastShown > 0 && firstLine > this.lastShown + 1;
  }

  private closing(total: number): string {
    if (this.fromLine > total) {
      return `The document has ${lineCountWords(total)}; fromLine ${this.fromLine} is past its end.`;
    }
    const from = this.fromLine === 1 ? "" : ` from line ${this.fromLine} on`;
    if (this.matchesShown === 0) return `No line${from} holds the phrase.`;
    const shown = `${matchesWords(this.matchesShown)}${from} shown, up to line ${this.lastMatch}`;
    return this.matchesAfter === 0
      ? `${shown}; none after it: the search reached the end of the document.`
      : `${shown}; ${amount(this.matchesAfter)} more after it. Search on with fromLine ${this.lastMatch + 1}.`;
  }
}

function matchesWords(count: number): string {
  return count === 1 ? "1 match" : `${amount(count)} matches`;
}

function amount(count: number): string {
  return count.toLocaleString("en-US");
}
