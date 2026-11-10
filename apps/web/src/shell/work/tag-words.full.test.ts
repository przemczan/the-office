import type { Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { tagOf, tagsInUse, withTag } from "./tag-words.ts";

describe("tagOf", () => {
  it("keeps a word lower-case with spaces made hyphens, as the service does", () => {
    expect(tagOf("  Dark   Mode ")).toBe("dark-mode");
    expect(tagOf("   ")).toBe("");
  });
});

describe("withTag", () => {
  it("adds a new Tag last and leaves the Tags as they are for one there or none", () => {
    const tags = ["ui"];

    expect(withTag(tags, "Bug")).toEqual(["ui", "bug"]);
    expect(withTag(tags, " UI ")).toBe(tags);
    expect(withTag(tags, " ")).toBe(tags);
  });
});

describe("tagsInUse", () => {
  it("lists every Tag once, in alphabetical order", () => {
    const tasks = [{ tags: ["ui", "bug"] }, { tags: [] }, { tags: ["ble", "ui"] }] as Task[];

    expect(tagsInUse(tasks)).toEqual(["ble", "bug", "ui"]);
  });
});
