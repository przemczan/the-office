/**
 * Parses JSON with comments, as devcontainer.json is written: `//` and `/* *\/` comments and a
 * comma before a closing bracket are dropped, outside strings; then it is read as JSON, which throws
 * a SyntaxError for anything else that isn't.
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(withoutTrailingCommas(withoutComments(text)));
}

function withoutComments(text: string): string {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"') {
      const end = endOfString(text, index);
      result += text.slice(index, end);
      index = end;
    } else if (character === "/" && next === "/") {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
    } else if (character === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      // An unclosed comment runs to the end, which JSON.parse then reports as unexpected.
      index = end === -1 ? text.length : end + 2;
      result += " ";
    } else {
      result += character;
      index++;
    }
  }
  return result;
}

function withoutTrailingCommas(text: string): string {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const end = endOfString(text, index);
      result += text.slice(index, end);
      index = end;
      continue;
    }
    if (character === ",") {
      const following = text.slice(index + 1).match(/^\s*/)?.[0].length ?? 0;
      const closing = text[index + 1 + following];
      if (closing === "}" || closing === "]") {
        index++;
        continue;
      }
    }
    result += character;
    index++;
  }
  return result;
}

/** The index just past the string starting at `start`, its escapes skipped. */
function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") index += 2;
    else if (text[index] === '"') return index + 1;
    else index++;
  }
  return text.length;
}
