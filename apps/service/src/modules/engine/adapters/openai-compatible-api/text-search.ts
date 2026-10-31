/** How the lines around a match are shown. */
export interface SearchContext {
  readonly before: number;
  readonly after: number;
}

/** A pattern searched for, as Grep's input sets it. */
export interface TextSearch {
  readonly expression: RegExp;
  readonly multiline: boolean;
}

/** One match: the lines it spans, 0-based, and the text it matched. */
interface Match {
  readonly firstLine: number;
  readonly lastLine: number;
  readonly text: string;
}

/** The search for `pattern`, or why it isn't a pattern. */
export function textSearch(
  pattern: string,
  { ignoreCase, multiline }: { readonly ignoreCase: boolean; readonly multiline: boolean },
): TextSearch | { readonly problem: string } {
  const flags = `g${ignoreCase ? "i" : ""}${multiline ? "s" : ""}mu`;
  try {
    return { expression: new RegExp(pattern, flags), multiline };
  } catch (error) {
    return {
      problem: `The pattern isn't a regular expression: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Every match in a file's lines. A pattern that isn't multiline matches within one line, as ripgrep's. */
function matches(search: TextSearch, lines: readonly string[]): Match[] {
  if (search.multiline) return multilineMatches(search, lines);
  return lines.flatMap((line, index) =>
    [...line.matchAll(search.expression)]
      .filter((match) => match[0] !== "" || line === "")
      .map((match) => ({ firstLine: index, lastLine: index, text: match[0] })),
  );
}

function multilineMatches(search: TextSearch, lines: readonly string[]): Match[] {
  const text = lines.join("\n");
  const lineStarts: number[] = [];
  let start = 0;
  for (const line of lines) {
    lineStarts.push(start);
    start += line.length + 1;
  }
  const lineAt = (offset: number) =>
    Math.max(
      lineStarts.findLastIndex((lineStart) => lineStart <= offset),
      0,
    );
  return [...text.matchAll(search.expression)]
    .filter((match) => match[0] !== "")
    .map((match) => ({
      firstLine: lineAt(match.index),
      lastLine: lineAt(match.index + match[0].length - 1),
      text: match[0],
    }));
}

export function splitLines(text: string): string[] {
  return text.replace(/\r?\n$/, "").split(/\r?\n/);
}

export function matchCount(search: TextSearch, lines: readonly string[]): number {
  return matches(search, lines).length;
}

/**
 * A file's matching lines as ripgrep prints them: `path:line:text` for a match, `path-line-text`
 * for a line around one, and `--` between groups that don't touch.
 */
export function matchingLines(
  path: string,
  search: TextSearch,
  lines: readonly string[],
  shown: {
    readonly context: SearchContext;
    readonly lineNumbers: boolean;
    readonly onlyMatching: boolean;
  },
): string[] {
  const found = matches(search, lines);
  if (shown.onlyMatching) {
    return found.map((match) => printed(path, match.firstLine, match.text, ":", shown.lineNumbers));
  }
  const matched = new Set(found.flatMap((match) => range(match.firstLine, match.lastLine)));
  const visible = new Set(
    [...matched].flatMap((line) =>
      range(
        Math.max(line - shown.context.before, 0),
        Math.min(line + shown.context.after, lines.length - 1),
      ),
    ),
  );
  const ordered = [...visible].toSorted((first, second) => first - second);
  return ordered.flatMap((line, index) => {
    const separator = index > 0 && ordered[index - 1]! < line - 1 ? ["--"] : [];
    const mark = matched.has(line) ? ":" : "-";
    return [...separator, printed(path, line, lines[line]!, mark, shown.lineNumbers)];
  });
}

function printed(
  path: string,
  line: number,
  text: string,
  mark: string,
  lineNumbers: boolean,
): string {
  return lineNumbers ? `${path}${mark}${line + 1}${mark}${text}` : `${path}${mark}${text}`;
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
