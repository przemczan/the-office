import { describe, expect, it } from "vitest";
import {
  matchingMentionables,
  mentionQueryAt,
  withMentionLinks,
  type Mentionable,
} from "./mention-words.ts";

const EXPORT: Mentionable = { kind: "task", label: "Export", path: "/tasks/a" };
const EXPORT_CSV: Mentionable = { kind: "task", label: "Export CSV [beta]", path: "/tasks/b" };
const DARK_MODE: Mentionable = { kind: "idea", label: "Dark mode", path: "/work/ideas?idea=c" };

describe("the @ being typed", () => {
  it("is found at the start of the message or after a space, up to the caret", () => {
    expect(mentionQueryAt("@exp", 4)).toEqual({ start: 0, query: "exp" });
    expect(mentionQueryAt("Look at @dark mo and", 16)).toEqual({ start: 8, query: "dark mo" });
  });

  it("is not an address, nor one on an earlier line", () => {
    expect(mentionQueryAt("mail me@example.com", 19)).toBeUndefined();
    expect(mentionQueryAt("@export\nnext", 12)).toBeUndefined();
  });
});

describe("the records the picker offers", () => {
  it("are those whose words hold the query, or whose kind starts with it", () => {
    const records = [EXPORT, EXPORT_CSV, DARK_MODE];

    expect(matchingMentionables(records, "csv")).toEqual([EXPORT_CSV]);
    expect(matchingMentionables(records, "ide")).toEqual([DARK_MODE]);
    expect(matchingMentionables(records, "")).toEqual(records);
  });
});

describe("a message with mentions", () => {
  it("links each picked record still in the text, the longest label first", () => {
    expect(
      withMentionLinks("Is @Export CSV [beta] done? See @Export and @Dark mode.", [
        EXPORT,
        EXPORT_CSV,
      ]),
    ).toBe("Is [@Export CSV \\[beta\\]](/tasks/b) done? See [@Export](/tasks/a) and @Dark mode.");
  });
});
