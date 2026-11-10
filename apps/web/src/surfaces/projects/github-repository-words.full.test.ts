import type { GitHubRepository } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  matchIn,
  pushedWords,
  repositoryKeyOf,
  repositoryRowsOf,
} from "./github-repository-words.ts";

function repository(fullName: string, pushedAt: string | null, description = ""): GitHubRepository {
  return {
    fullName,
    repositoryUrl: `https://github.com/${fullName}.git`,
    private: false,
    defaultBranch: "main",
    pushedAt,
    description,
  };
}

const REPOSITORIES = [
  repository("pdev/old-notes", "2025-03-01T10:00:00Z", "Notes from before"),
  repository("notnullsoft/the-office", "2026-11-07T09:00:00Z", "A workspace run like an office"),
  repository("notnullsoft/billing", "2026-11-06T12:00:00Z", "Invoices for pdev"),
  repository("pdev/empty", null),
];

describe("repositoryRowsOf", () => {
  it("puts the most recently pushed on top, never pushed last", () => {
    const rows = repositoryRowsOf(REPOSITORIES, [], "");

    expect(rows.map((row) => row.repository.fullName)).toEqual([
      "notnullsoft/the-office",
      "notnullsoft/billing",
      "pdev/old-notes",
      "pdev/empty",
    ]);
  });

  it("marks a repository already added as a Project, by any form of its URL, and puts it last", () => {
    const rows = repositoryRowsOf(
      REPOSITORIES,
      [
        { name: "The Office", repositoryUrl: "git@github.com:notnullsoft/the-office.git" },
        { name: "From a folder", repositoryUrl: null },
      ],
      "",
    );

    expect(rows.map((row) => [row.repository.fullName, row.addedAs])).toEqual([
      ["notnullsoft/billing", undefined],
      ["pdev/old-notes", undefined],
      ["pdev/empty", undefined],
      ["notnullsoft/the-office", "The Office"],
    ]);
  });

  it("matches the name, the owner and the description, whatever their case", () => {
    const byOwner = repositoryRowsOf(REPOSITORIES, [], "PDEV");

    expect(byOwner.map((row) => row.repository.fullName)).toEqual([
      "notnullsoft/billing",
      "pdev/old-notes",
      "pdev/empty",
    ]);
    expect(repositoryRowsOf(REPOSITORIES, [], " office ").map((row) => row.name)).toEqual([
      "the-office",
    ]);
  });

  it("splits the owner from the name", () => {
    const [row] = repositoryRowsOf([repository("notnullsoft/billing", null)], [], "");

    expect(row).toMatchObject({ owner: "notnullsoft", name: "billing" });
  });
});

describe("repositoryKeyOf", () => {
  it("reads https, ssh:// and scp-like URLs alike, with or without .git", () => {
    const key = "github.com/owner/repository";

    expect(repositoryKeyOf("https://github.com/Owner/Repository.git")).toBe(key);
    expect(repositoryKeyOf("https://github.com/owner/repository/")).toBe(key);
    expect(repositoryKeyOf("git@github.com:owner/repository.git")).toBe(key);
    expect(repositoryKeyOf("ssh://git@github.com:22/owner/repository.git")).toBe(key);
  });
});

describe("matchIn", () => {
  it("splits the text around the first match, keeping its case", () => {
    expect(matchIn("The-Office", "office")).toEqual(["The-", "Office", ""]);
  });

  it("finds nothing for an empty search or no match", () => {
    expect(matchIn("billing", " ")).toBeUndefined();
    expect(matchIn("billing", "office")).toBeUndefined();
  });
});

describe("pushedWords", () => {
  const now = new Date(2026, 10, 7, 15, 0);

  it("says today with its time, yesterday, then the day", () => {
    expect(pushedWords(new Date(2026, 10, 7, 9, 5).toISOString(), now)).toBe(
      "pushed today at 09:05",
    );
    expect(pushedWords(new Date(2026, 10, 6, 22, 0).toISOString(), now)).toBe("pushed yesterday");
    expect(pushedWords(new Date(2026, 9, 25, 12, 0).toISOString(), now)).toBe("pushed 25 Oct");
    expect(pushedWords(new Date(2024, 9, 25, 12, 0).toISOString(), now)).toBe("pushed 25 Oct 2024");
  });

  it("says never pushed without a time", () => {
    expect(pushedWords(null, now)).toBe("never pushed");
  });
});
