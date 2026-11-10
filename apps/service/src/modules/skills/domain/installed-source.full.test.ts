import { describe, expect, it } from "vitest";
import {
  compareTags,
  fallbackNameOf,
  isUpdateOf,
  pinnedVersionLabel,
  pinnedVersionOf,
  sourceFolderProblem,
  sourceRepositoryProblems,
  sourceUrl,
} from "./installed-source.js";

describe("sourceRepositoryProblems", () => {
  it.each([
    "anthropics/skills",
    "owner/repo.git",
    "https://gitlab.com/group/skills.git",
    "ssh://git@example.com/skills.git",
    "git@github.com:owner/skills.git",
    "file:///D:/sources/skills.git",
  ])("takes %s", (repository) => {
    expect(sourceRepositoryProblems(repository)).toEqual([]);
  });

  it.each([
    "skills",
    "owner/../repo",
    "http://example.com/skills.git",
    "ext::sh -c touch% /tmp/pwned",
    "--upload-pack=touch /tmp/pwned",
    "D:\\sources\\skills",
    "https://example.com/a b",
  ])("refuses %s", (repository) => {
    expect(sourceRepositoryProblems(repository)).toHaveLength(1);
  });

  it("asks for a source when none is given", () => {
    expect(sourceRepositoryProblems("")).toEqual(["Give a source: owner/repo or a git URL."]);
  });
});

describe("sourceUrl", () => {
  it("finds owner/repo on GitHub", () => {
    expect(sourceUrl("anthropics/skills")).toBe("https://github.com/anthropics/skills.git");
    expect(sourceUrl("anthropics/skills.git")).toBe("https://github.com/anthropics/skills.git");
  });

  it("keeps a git URL as given", () => {
    expect(sourceUrl("git@github.com:owner/skills.git")).toBe("git@github.com:owner/skills.git");
  });
});

describe("sourceFolderProblem", () => {
  it.each(["", "skills/notes"])("takes %j", (folder) => {
    expect(sourceFolderProblem(folder)).toBeUndefined();
  });

  it.each(["../notes", "/notes", "skills\\notes"])("refuses %s", (folder) => {
    expect(sourceFolderProblem(folder)).toBe(`"${folder}" is no folder inside the source.`);
  });
});

describe("fallbackNameOf", () => {
  it("is the folder's own name", () => {
    expect(fallbackNameOf({ repository: "owner/repo", folder: "skills/Release Notes" })).toBe(
      "release-notes",
    );
  });

  it("is the repository's name for its top folder", () => {
    expect(fallbackNameOf({ repository: "git@github.com:owner/notes.git", folder: "" })).toBe(
      "notes",
    );
  });
});

describe("pinnedVersionOf", () => {
  it("pins the newest tag as a version, at the commit an annotated tag points at", () => {
    expect(
      pinnedVersionOf([
        { name: "HEAD", commit: "head" },
        { name: "refs/tags/v1.9.0", commit: "nine" },
        { name: "refs/tags/v1.10.0", commit: "tag-object" },
        { name: "refs/tags/v1.10.0^{}", commit: "ten" },
        { name: "refs/tags/v1.11.0-beta", commit: "beta" },
      ]),
    ).toEqual({ tag: "v1.11.0-beta", commit: "beta" });
  });

  it("pins the newest commit when there are no tags", () => {
    expect(pinnedVersionOf([{ name: "HEAD", commit: "head" }])).toEqual({ commit: "head" });
  });

  it("finds nothing to pin in a repository with no commits", () => {
    expect(pinnedVersionOf([])).toBeUndefined();
  });
});

describe("compareTags", () => {
  it.each([
    ["v1.10", "v1.9"],
    ["v2.0.0", "v2.0.0-beta"],
    ["v2.0.0-rc.2", "v2.0.0-rc.1"],
    ["2024-06-01", "2024-05-30"],
  ])("takes %s as newer than %s", (newer, older) => {
    expect(compareTags(newer, older)).toBeGreaterThan(0);
    expect(compareTags(older, newer)).toBeLessThan(0);
  });
});

describe("pinnedVersionLabel", () => {
  it("is the tag, or the commit's first characters", () => {
    expect(pinnedVersionLabel({ tag: "v1.0", commit: "abcdef123" })).toBe("v1.0");
    expect(pinnedVersionLabel({ commit: "abcdef123" })).toBe("abcdef1");
  });
});

describe("isUpdateOf", () => {
  const pinned = { tag: "v1.9", commit: "a" };

  it("is a newer tag at another commit", () => {
    expect(isUpdateOf({ tag: "v1.10", commit: "b" }, pinned)).toBe(true);
  });

  it("is no older or equal tag, nor the pinned commit", () => {
    expect(isUpdateOf({ tag: "v1.8", commit: "b" }, pinned)).toBe(false);
    expect(isUpdateOf({ tag: "v1.9", commit: "b" }, pinned)).toBe(false);
    expect(isUpdateOf({ tag: "v2.0", commit: "a" }, pinned)).toBe(false);
  });

  it("is no untagged commit once the skill is pinned at a tag", () => {
    expect(isUpdateOf({ commit: "b" }, pinned)).toBe(false);
  });

  it("is any other commit, tagged or not, of a skill pinned without a tag", () => {
    expect(isUpdateOf({ commit: "b" }, { commit: "a" })).toBe(true);
    expect(isUpdateOf({ tag: "v1", commit: "b" }, { commit: "a" })).toBe(true);
  });
});
