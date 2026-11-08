import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc.js";

describe("parseJsonc", () => {
  it("drops comments and trailing commas outside strings", () => {
    const text = `{
      // a line comment
      "url": "http://example.com/*not a comment*/", /* a block comment */
      "list": [1, 2,],
      "quote": "a \\" // still the string",
    }`;

    expect(parseJsonc(text)).toEqual({
      url: "http://example.com/*not a comment*/",
      list: [1, 2],
      quote: 'a " // still the string',
    });
  });

  it("throws on what isn't JSON even then", () => {
    expect(() => parseJsonc("{ name: 1 }")).toThrow(SyntaxError);
  });
});
