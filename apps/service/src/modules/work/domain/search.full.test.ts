import { describe, expect, it } from "vitest";
import { MAX_SEARCH_WORDS, idPrefixOf, searchWords, searchedText } from "./search.js";

describe("searchWords", () => {
  it("lower-cases each word and keeps it once", () => {
    expect(searchWords("Login login FLOW")).toEqual(["login", "flow"]);
  });

  it("splits at anything but letters and digits, so no query syntax gets through", () => {
    expect(searchWords("ui-polish & !(v2):* 'tag'")).toEqual(["ui", "polish", "v2", "tag"]);
  });

  it("keeps letters of any language", () => {
    expect(searchWords("Zażółć gęślą")).toEqual(["zażółć", "gęślą"]);
  });

  it("finds no words in blanks and punctuation", () => {
    expect(searchWords("  -- ! ")).toEqual([]);
  });

  it(`reads at most ${MAX_SEARCH_WORDS} words`, () => {
    const words = Array.from({ length: MAX_SEARCH_WORDS + 3 }, (_, index) => `w${index}`);
    expect(searchWords(words.join(" "))).toEqual(words.slice(0, MAX_SEARCH_WORDS));
  });
});

describe("idPrefixOf", () => {
  const id = "8c7ba0c3-5174-4244-86c6-5ffcfadbebef";

  it("reads a full ID, lower-cased and trimmed", () => {
    expect(idPrefixOf(` ${id.toUpperCase()} `)).toBe(id);
  });

  it("reads the first 8 characters of an ID", () => {
    expect(idPrefixOf("8c7ba0c3")).toBe("8c7ba0c3");
  });

  it("reads nothing shorter than 8 characters, or plain words", () => {
    expect(idPrefixOf("8c7ba0c")).toBeUndefined();
    expect(idPrefixOf("login flow")).toBeUndefined();
    expect(idPrefixOf("deadline")).toBeUndefined();
  });
});

describe("searchedText", () => {
  it("leaves out NUL characters, which Postgres stores in no text", () => {
    expect(searchedText("one\u0000two")).toBe("onetwo");
  });
});
