import type { ProjectEnvironment } from "./project-environment.js";

/** A Secret variable's value, and the name it is shown by in its place. */
export interface SecretValue {
  readonly name: string;
  readonly value: string;
}

/** Output masked as it comes, chunk by chunk, for a file written while a command runs. */
export interface MaskedChunks {
  /** The masked bytes that can be written now; the end of the chunk may be held back. */
  next(chunk: Uint8Array): Uint8Array;
  /** What was held back, masked, once the output has ended. */
  end(): Uint8Array;
}

/**
 * Hides Secret variables' values in output (spec §6): each one shows as `[secret NAME]`. Where
 * two values overlap, the longer one is hidden.
 */
export class OutputMask {
  static readonly NONE = new OutputMask([]);

  /** Matches the values as text, longest first so a value inside another hides the whole. */
  private readonly textPattern: RegExp | undefined;
  /** The same, over bytes read one character each (latin1), so a chunk cut mid-character works. */
  private readonly bytePattern: RegExp | undefined;
  private readonly nameByText: ReadonlyMap<string, string>;
  private readonly nameByBytes: ReadonlyMap<string, string>;
  private readonly longestBytes: number;

  constructor(secrets: readonly SecretValue[]) {
    const kept = secrets
      .filter(({ value }) => value !== "")
      .toSorted((one, other) => other.value.length - one.value.length);
    const asBytes = kept.map(({ name, value }) => ({ name: bytesOf(name), value: bytesOf(value) }));
    this.textPattern = alternation(kept.map(({ value }) => value));
    this.bytePattern = alternation(asBytes.map(({ value }) => value));
    this.nameByText = new Map(kept.map(({ name, value }) => [value, name]));
    this.nameByBytes = new Map(asBytes.map(({ name, value }) => [value, name]));
    this.longestBytes = Math.max(0, ...asBytes.map(({ value }) => value.length));
  }

  /** Masks the environment's Secret variables. */
  static of(environment: ProjectEnvironment): OutputMask {
    const secrets = environment.set.filter((variable) => variable.secret);
    return secrets.length === 0 ? OutputMask.NONE : new OutputMask(secrets);
  }

  get hidesNothing(): boolean {
    return this.textPattern === undefined;
  }

  mask(text: string): string {
    if (this.textPattern === undefined) return text;
    return text.replace(this.textPattern, (value) => placeholder(this.nameByText.get(value)));
  }

  /**
   * Masks output as it comes. A chunk's end that may be the start of a value is held back until
   * the next chunk shows whether it is, so a value cut across chunks is hidden too.
   */
  chunks(): MaskedChunks {
    const pattern = this.bytePattern;
    if (pattern === undefined) return { next: (chunk) => chunk, end: () => new Uint8Array() };
    let held = "";
    const masked = (text: string): string =>
      text.replace(pattern, (value) => placeholder(this.nameByBytes.get(value)));
    return {
      next: (chunk) => {
        const text = held + Buffer.from(chunk).toString("latin1");
        const cut = this.safeCut(text, pattern);
        held = text.slice(cut);
        return Buffer.from(masked(text.slice(0, cut)), "latin1");
      },
      end: () => {
        const rest = masked(held);
        held = "";
        return Buffer.from(rest, "latin1");
      },
    };
  }

  /**
   * Where the text can be cut with no value across the cut: before the last `longest - 1`
   * characters, which may start one, or after a whole value found across that point.
   */
  private safeCut(text: string, pattern: RegExp): number {
    let cut = Math.max(0, text.length - (this.longestBytes - 1));
    for (const match of text.matchAll(pattern)) {
      if (match.index >= cut) break;
      cut = Math.max(cut, match.index + match[0].length);
    }
    return cut;
  }
}

/** The text's UTF-8 bytes, one latin1 character each. */
function bytesOf(text: string): string {
  return Buffer.from(text, "utf8").toString("latin1");
}

function alternation(values: readonly string[]): RegExp | undefined {
  if (values.length === 0) return undefined;
  return new RegExp(values.map(escapedForPattern).join("|"), "g");
}

function escapedForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function placeholder(name: string | undefined): string {
  return `[secret ${name ?? ""}]`;
}
