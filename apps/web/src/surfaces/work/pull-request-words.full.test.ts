import { describe, expect, it } from "vitest";
import { branchWords, checkedWords, problemWords, pullRequestName } from "./pull-request-words.ts";

const NOW = new Date("2026-11-19T14:00:00.000Z");

describe("pull request words", () => {
  it("names a pull request by its number and title, and its branch into its base", () => {
    expect(pullRequestName({ number: 42, title: "Remember the sort" })).toBe(
      "#42 Remember the sort",
    );
    expect(branchWords({ branch: "office/abc", baseBranch: "main" })).toBe("office/abc → main");
  });

  it("says when its status was read: how long ago within the day, the moment before", () => {
    expect(checkedWords(null, NOW)).toBe("Not checked yet");
    expect(checkedWords("2026-11-19T13:59:40.000Z", NOW)).toBe("<1 min ago");
    expect(checkedWords("2026-11-19T13:42:00.000Z", NOW)).toBe("18 min ago");
    expect(checkedWords("2026-11-17T10:05:00.000Z", NOW)).toMatch(/^17 Nov, \d\d:05$/);
  });

  it("says why a Project wasn't refreshed: the host's words, or since when it failed", () => {
    const text = "No one is signed in.";
    expect(problemWords({ kind: "cannot-read", projectId: "billing", text })).toBe(text);
    const unreachable = {
      kind: "unreachable",
      projectId: "billing",
      codeHost: "GitHub",
      failedAt: "2026-11-19T14:02:00.000Z",
    } as const;
    expect(problemWords({ ...unreachable, lastReadAt: null })).toMatch(
      /^GitHub couldn't be reached at \d\d:02\.$/,
    );
  });
});
