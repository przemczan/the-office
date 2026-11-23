import { describe, expect, it } from "vitest";
import { publishedMessage, publishOutcome } from "./publish.js";

describe("publishedMessage", () => {
  it("is the commit message whole, its first line the subject and the rest the body", () => {
    expect(
      publishedMessage("  Rename a device\n\nAdds a rename dialog.\n\nIt saves on Enter.\n"),
    ).toEqual({
      subject: "Rename a device",
      body: "Adds a rename dialog.\n\nIt saves on Enter.",
      whole: "Rename a device\n\nAdds a rename dialog.\n\nIt saves on Enter.",
    });
  });

  it("has an empty body for a message of one line", () => {
    expect(publishedMessage("Rename a device")).toEqual({
      subject: "Rename a device",
      body: "",
      whole: "Rename a device",
    });
  });
});

describe("publishOutcome", () => {
  it("is done with the pull request it opened", () => {
    expect(
      publishOutcome({
        kind: "pull-request-opened",
        branch: "office/task-1",
        url: "https://github.com/notnullsoft/admin/pull/7",
      }),
    ).toEqual({
      status: "done",
      publishResult: "published",
      summary:
        "Pushed office/task-1 and opened the pull request https://github.com/notnullsoft/admin/pull/7",
      pullRequestUrl: "https://github.com/notnullsoft/admin/pull/7",
    });
  });

  it("is done with the one commit that landed the Task, by its subject", () => {
    expect(
      publishOutcome({
        kind: "merged",
        branch: "office/task-1",
        into: { remote: "origin", branch: "main" },
        commit: "0123456789abcdef0123456789abcdef01234567",
        subject: "Rename a device",
        head: "fedcba9876543210fedcba9876543210fedcba98",
        baseTakenIn: "not-needed",
      }),
    ).toEqual({
      status: "done",
      publishResult: "published",
      summary: 'Landed office/task-1 on main on origin as one commit, 01234567 "Rename a device".',
    });
  });

  it("says it merged the base in first when the base had moved on", () => {
    expect(
      publishOutcome({
        kind: "merged",
        branch: "office/task-1",
        into: { remote: "origin", branch: "main" },
        commit: "0123456789abcdef0123456789abcdef01234567",
        subject: "Rename a device",
        head: "fedcba9876543210fedcba9876543210fedcba98",
        baseTakenIn: "by-merge",
      }),
    ).toEqual({
      status: "done",
      publishResult: "published",
      summary:
        'Merged main, which had moved on, into office/task-1, then landed office/task-1 on main on origin as one commit, 01234567 "Rename a device".',
    });
  });

  it("is done with where a Publishing Task's merge left the base, its commits carried unchanged", () => {
    expect(
      publishOutcome({
        kind: "merged",
        branch: "initiative/usage-exports",
        into: { remote: "origin", branch: "main" },
        commit: "0123456789abcdef0123456789abcdef01234567",
        head: "0123456789abcdef0123456789abcdef01234567",
        baseTakenIn: "not-needed",
      }),
    ).toEqual({
      status: "done",
      publishResult: "published",
      summary: "Merged initiative/usage-exports into main on origin, which is now at 01234567.",
    });
  });

  it("names only the bases that had moved on when merging into an Initiative's branch", () => {
    expect(
      publishOutcome({
        kind: "merged",
        branch: "office/task-1",
        into: { remote: "origin", branch: "initiative/usage-exports" },
        commit: "0123456789abcdef0123456789abcdef01234567",
        subject: "Rename a device",
        head: "fedcba9876543210fedcba9876543210fedcba98",
        baseTakenIn: "by-merge",
        basesTakenIn: ["main"],
      }),
    ).toEqual({
      status: "done",
      publishResult: "published",
      summary:
        'Merged main, which had moved on, into office/task-1, then landed office/task-1 on initiative/usage-exports on origin as one commit, 01234567 "Rename a device".',
    });
  });

  it("fails with the base moved on, which asks the user, or with the error, which goes back", () => {
    expect(
      publishOutcome({
        kind: "base-moved",
        error: "It conflicts.",
        base: { remote: "origin", branch: "main" },
        conflictedFiles: ["a.ts"],
      }),
    ).toEqual({
      status: "failed",
      error: "It conflicts.",
      baseMoved: { conflictedFiles: ["a.ts"], baseBranch: "main" },
      publishResult: "conflict",
    });
    expect(publishOutcome({ kind: "failed", error: "Pushing failed." })).toEqual({
      status: "failed",
      error: "Pushing failed.",
      publishResult: "failed",
    });
  });
});
