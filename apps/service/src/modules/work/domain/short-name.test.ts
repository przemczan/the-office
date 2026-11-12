import { describe, expect, it } from "vitest";
import { derivedShortName, initiativeBranchOf, shortNameProblems } from "./short-name.js";

const ID = "1116efba-cd8f-4089-8609-c96284d5912e";
const NONE_TAKEN = new Set<string>();

describe("derivedShortName", () => {
  it("drops accents, lower-cases and joins the words with -", () => {
    expect(derivedShortName("Gęślą jaźń: Café Ünïcode!", ID, NONE_TAKEN)).toBe(
      "gesla-jazn-cafe-unicode",
    );
  });

  it("trims - at both ends", () => {
    expect(derivedShortName("  --Sync, now!-- ", ID, NONE_TAKEN)).toBe("sync-now");
  });

  it("is at most 40 characters, cut at a word", () => {
    const title = "Initiatives that publish on their own branch across every Project";

    const shortName = derivedShortName(title, ID, NONE_TAKEN);

    expect(shortName).toBe("initiatives-that-publish-on-their-own");
    expect(shortName.length).toBeLessThanOrEqual(40);
  });

  it("cuts a first word longer than 40 characters inside it", () => {
    expect(derivedShortName("a".repeat(50), ID, NONE_TAKEN)).toBe("a".repeat(40));
  });

  it("is the first 8 characters of the id when nothing is left of the title", () => {
    expect(derivedShortName("→ ✓ !!", ID, NONE_TAKEN)).toBe("1116efba");
  });

  it("gets -2, -3 and so on when the name is taken", () => {
    expect(derivedShortName("Sync", ID, new Set(["sync"]))).toBe("sync-2");
    expect(derivedShortName("Sync", ID, new Set(["sync", "sync-2"]))).toBe("sync-3");
  });

  it("cuts the stem so a taken name with its number stays at most 40 characters", () => {
    const title = "aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd";
    const stem = derivedShortName(title, ID, NONE_TAKEN);

    const shortName = derivedShortName(title, ID, new Set([stem]));

    expect(stem).toHaveLength(39);
    expect(shortName).toBe("aaaaaaaaa-bbbbbbbbb-ccccccccc-2");
    expect(shortName.length).toBeLessThanOrEqual(40);
  });
});

describe("shortNameProblems", () => {
  it("keeps a name of the form nobody holds", () => {
    expect(shortNameProblems("sync-2026", NONE_TAKEN)).toEqual([]);
  });

  it("refuses an empty name", () => {
    expect(shortNameProblems("", NONE_TAKEN)).toEqual([
      "Write a Short name: the Initiative's branch is named by it.",
    ]);
  });

  it("refuses more than 40 characters", () => {
    expect(shortNameProblems("a".repeat(41), NONE_TAKEN)).toEqual([
      "A Short name is at most 40 characters; this one has 41.",
    ]);
  });

  it.each(["Sync", "sync_now", "-sync", "sync-", "sync--now", "sync/now", "zażółć"])(
    "refuses %s, which isn't of the form",
    (edited) => {
      expect(shortNameProblems(edited, NONE_TAKEN)).toEqual([
        "A Short name is lower-case letters a–z and digits 0–9, words joined by a single -, with no - at either end.",
      ]);
    },
  );

  it("refuses a name another Initiative holds", () => {
    expect(shortNameProblems("sync", new Set(["sync"]))).toEqual([
      "Another Initiative has the Short name sync; choose another.",
    ]);
  });
});

describe("initiativeBranchOf", () => {
  it("names the branch by the Short name", () => {
    expect(initiativeBranchOf("sync")).toBe("initiative/sync");
  });
});
