/**
 * Only this much of a statement is read and shaped (spec 5.2, System health), so a shape stays
 * bounded; a long VALUES list or IN list cut short still becomes one `?`.
 */
export const READ_LENGTH = 8_192;

/** Ends the shape of a statement longer than `READ_LENGTH`. */
const CUT_MARK = "…";

/** A statement's shape, and the operation and table it is counted by. */
export interface StatementShape {
  /**
   * Whitespace collapsed, values and parameters `?`, IN lists and VALUES rows one `?`; ends with
   * `…` when the statement was longer than what is read.
   */
  readonly shape: string;
  /** The statement's main keyword upper-cased, such as `SELECT`; "" when it has none. */
  readonly operation: string;
  /** The table it reads or writes, unquoted and without its schema; "" when it names none. */
  readonly table: string;
}

type TokenKind = "word" | "identifier" | "value" | "space" | "symbol";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const VALUE: Token = { kind: "value", text: "?" };
const SPACE: Token = { kind: "space", text: " " };

const MAIN_STATEMENTS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "VALUES"]);

/** The keyword a statement names its table after; UPDATE names it straight after itself. */
const TABLE_KEYWORDS = new Map([
  ["SELECT", "FROM"],
  ["DELETE", "FROM"],
  ["INSERT", "INTO"],
  ["MERGE", "INTO"],
]);

/** The shape a statement is named by in System health's slowest queries (glossary, Statement shape). */
export function statementShapeOf(statement: string): StatementShape {
  const tokens = collapseLists(tokenize(statement.slice(0, READ_LENGTH)));
  const shape = tokens
    .map((token) => token.text)
    .join("")
    .trim();
  return {
    shape: statement.length > READ_LENGTH ? `${shape}${CUT_MARK}` : shape,
    ...operationAndTable(tokens),
  };
}

function isWordStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_\u0080-￿]/.test(char);
}

function isWordPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$\u0080-￿]/.test(char);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

/**
 * Reads the statement as Postgres would: words, quoted identifiers, values (strings, numbers and
 * `$n` parameters, each one `?`), runs of whitespace and comments (one space), and symbols.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const push = (token: Token): void => {
    if (token.kind === "space" && (tokens.length === 0 || tokens.at(-1)?.kind === "space")) return;
    tokens.push(token);
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    const next = text[at + 1];
    if (isSpace(char)) {
      while (isSpace(text[at])) at += 1;
      push(SPACE);
    } else if (char === "-" && next === "-") {
      const end = text.indexOf("\n", at);
      at = end === -1 ? text.length : end + 1;
      push(SPACE);
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", at + 2);
      at = end === -1 ? text.length : end + 2;
      push(SPACE);
    } else if (char === "'") {
      at = stringEnd(text, at, false);
      push(VALUE);
    } else if (char === '"') {
      const end = quotedIdentifierEnd(text, at);
      push({ kind: "identifier", text: text.slice(at, end) });
      at = end;
    } else if (char === "$" && isDigit(next)) {
      at += 1;
      while (isDigit(text[at])) at += 1;
      push(VALUE);
    } else if (char === "$" && dollarTag(text, at) !== undefined) {
      const tag = dollarTag(text, at) ?? "";
      const end = text.indexOf(tag, at + tag.length);
      at = end === -1 ? text.length : end + tag.length;
      push(VALUE);
    } else if (isDigit(char) || (char === "." && isDigit(next))) {
      at = numberEnd(text, at);
      push(VALUE);
    } else if (isWordStart(char)) {
      let end = at;
      while (isWordPart(text[end])) end += 1;
      const word = text.slice(at, end);
      // E'…' takes backslash escapes; B'…', X'…' and N'…' are values too.
      if (text[end] === "'" && /^[EeBbXxNn]$/.test(word)) {
        at = stringEnd(text, end, /^[Ee]$/.test(word));
        push(VALUE);
      } else {
        push({ kind: "word", text: word });
        at = end;
      }
    } else {
      push({ kind: "symbol", text: char ?? "" });
      at += 1;
    }
  }
  return tokens;
}

/** Past the closing quote of the string opening at `at`; `''` (and `\'` with escapes) stays inside. */
function stringEnd(text: string, at: number, backslashEscapes: boolean): number {
  let end = at + 1;
  while (end < text.length) {
    const char = text[end];
    if (backslashEscapes && char === "\\") end += 2;
    else if (char === "'" && text[end + 1] === "'") end += 2;
    else if (char === "'") return end + 1;
    else end += 1;
  }
  return text.length;
}

function quotedIdentifierEnd(text: string, at: number): number {
  let end = at + 1;
  while (end < text.length) {
    if (text[end] === '"' && text[end + 1] === '"') end += 2;
    else if (text[end] === '"') return end + 1;
    else end += 1;
  }
  return text.length;
}

/** The dollar quote's tag, `$$` or `$tag$`, opening at `at`; undefined when none opens there. */
function dollarTag(text: string, at: number): string | undefined {
  if (text[at + 1] === "$") return "$$";
  if (!isWordStart(text[at + 1])) return undefined;
  let end = at + 1;
  while (end < text.length && text[end] !== "$" && isWordPart(text[end])) end += 1;
  return text[end] === "$" ? text.slice(at, end + 1) : undefined;
}

function numberEnd(text: string, at: number): number {
  let end = at;
  while (isDigit(text[end]) || text[end] === "." || text[end] === "_") end += 1;
  if ((text[end] === "e" || text[end] === "E") && /[-+0-9]/.test(text[end + 1] ?? "")) {
    end += text[end + 1] === "-" || text[end + 1] === "+" ? 2 : 1;
    while (isDigit(text[end])) end += 1;
  }
  return end;
}

function isWord(token: Token | undefined, upper: string): boolean {
  return token?.kind === "word" && token.text.toUpperCase() === upper;
}

function isSymbol(token: Token | undefined, symbol: string): boolean {
  return token?.kind === "symbol" && token.text === symbol;
}

/** The index after the parenthesised group opening at `open`, its end when it never closes. */
function groupEnd(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let at = open; at < tokens.length; at += 1) {
    if (isSymbol(tokens[at], "(")) depth += 1;
    else if (isSymbol(tokens[at], ")")) depth -= 1;
    if (depth === 0) return at + 1;
  }
  return tokens.length;
}

/** The index of the first token from `at` that isn't a space. */
function skipSpace(tokens: readonly Token[], at: number): number {
  let index = at;
  while (tokens[index]?.kind === "space") index += 1;
  return index;
}

const ONE_VALUE_GROUP: readonly Token[] = [
  { kind: "symbol", text: "(" },
  VALUE,
  { kind: "symbol", text: ")" },
];

/** `IN (?, ?, ?)` becomes `IN (?)`, and `VALUES (…), (…)` becomes `VALUES (?)`. */
function collapseLists(tokens: readonly Token[]): Token[] {
  const collapsed: Token[] = [];
  let at = 0;
  while (at < tokens.length) {
    const token = tokens[at];
    if (token === undefined) break;
    collapsed.push(token);
    at += 1;
    if (isWord(token, "IN")) {
      const open = skipSpace(tokens, at);
      if (!isSymbol(tokens[open], "(")) continue;
      const end = groupEnd(tokens, open);
      const inside = tokens.slice(open + 1, end - 1);
      if (
        inside.every(
          (each) => each.kind === "value" || each.kind === "space" || isSymbol(each, ","),
        )
      ) {
        collapsed.push(...tokens.slice(at, open), ...ONE_VALUE_GROUP);
        at = end;
      }
    } else if (isWord(token, "VALUES")) {
      const open = skipSpace(tokens, at);
      if (!isSymbol(tokens[open], "(")) continue;
      collapsed.push(...tokens.slice(at, open), ...ONE_VALUE_GROUP);
      at = groupEnd(tokens, open);
      for (let comma = skipSpace(tokens, at); isSymbol(tokens[comma], ",");) {
        const nextRow = skipSpace(tokens, comma + 1);
        if (!isSymbol(tokens[nextRow], "(")) break;
        at = groupEnd(tokens, nextRow);
        comma = skipSpace(tokens, at);
      }
    }
  }
  return collapsed;
}

/** The statement's main keyword and its table, past any WITH's common table expressions. */
function operationAndTable(tokens: readonly Token[]): Pick<StatementShape, "operation" | "table"> {
  const words = topLevel(tokens);
  const first = words[0];
  if (first === undefined) return { operation: "", table: "" };
  let main = 0;
  if (isWord(tokens[first], "WITH")) {
    const found = words.findIndex((index) =>
      MAIN_STATEMENTS.has(tokens[index]?.text.toUpperCase() ?? ""),
    );
    if (found === -1) return { operation: "WITH", table: "" };
    main = found;
  }
  const mainIndex = words[main] ?? first;
  const operation = (tokens[mainIndex]?.text ?? "").toUpperCase();
  return { operation, table: tableOf(operation, tokens, words.slice(main)) };
}

/** The indexes of the words outside any parentheses. */
function topLevel(tokens: readonly Token[]): number[] {
  const words: number[] = [];
  let depth = 0;
  tokens.forEach((token, index) => {
    if (isSymbol(token, "(")) depth += 1;
    else if (isSymbol(token, ")")) depth = Math.max(0, depth - 1);
    else if (depth === 0 && token.kind === "word") words.push(index);
  });
  return words;
}

function tableOf(operation: string, tokens: readonly Token[], words: readonly number[]): string {
  const keyword = TABLE_KEYWORDS.get(operation);
  if (operation === "UPDATE") {
    const start = words[0];
    return start === undefined ? "" : nameAfter(tokens, start + 1);
  }
  if (keyword === undefined) return "";
  const at = words.find((index) => isWord(tokens[index], keyword));
  return at === undefined ? "" : nameAfter(tokens, at + 1);
}

/**
 * The table named from `at`: past ONLY, the last part of `schema.table`, unquoted; "" when a
 * subquery or nothing follows.
 */
function nameAfter(tokens: readonly Token[], at: number): string {
  let index = skipSpace(tokens, at);
  if (isWord(tokens[index], "ONLY")) index = skipSpace(tokens, index + 1);
  let name = "";
  for (;;) {
    const token = tokens[index];
    if (token?.kind !== "word" && token?.kind !== "identifier") return name;
    name = token.kind === "identifier" ? token.text.slice(1, -1).replaceAll('""', '"') : token.text;
    if (!isSymbol(tokens[index + 1], ".")) return name;
    index += 2;
  }
}
