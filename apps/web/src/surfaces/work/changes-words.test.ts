import { describe, expect, it } from "vitest";
import { diffLines, editorLink, fileLineWords } from "./changes-words.ts";

describe("diffLines", () => {
  it("tells the file header, hunks, added, removed and unchanged lines apart", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "--- a removed line that starts with dashes",
      "+++ an added line that starts with pluses",
      "diff --git a/b.md b/b.md",
      "--- a/b.md",
      "",
    ].join("\n");

    expect(diffLines(diff).map(({ kind }) => kind)).toEqual([
      "file",
      "file",
      "file",
      "file",
      "hunk",
      "context",
      "removed",
      "added",
      "removed",
      "added",
      "file",
      "file",
    ]);
  });

  it("has no lines for no diff", () => {
    expect(diffLines("")).toEqual([]);
  });
});

describe("fileLineWords", () => {
  it("counts a text file's lines and calls a binary file binary", () => {
    expect(
      fileLineWords({
        path: "a.ts",
        previousPath: null,
        lines: { added: 14, removed: 6 },
        deleted: false,
      }),
    ).toEqual({ added: "+14", removed: "−6" });
    expect(
      fileLineWords({ path: "logo.png", previousPath: null, lines: null, deleted: false }),
    ).toBe("binary");
  });
});

describe("editorLink", () => {
  it("opens a Windows worktree with forward slashes and its drive letter", () => {
    expect(editorLink("C:\\Users\\ada\\office-data\\worktrees\\admin\\task-1")).toBe(
      "vscode://file/C:/Users/ada/office-data/worktrees/admin/task-1",
    );
  });

  it("opens a file of a Linux worktree", () => {
    expect(editorLink("/home/ada/.office/worktrees/admin/task-1/", "src/ble/link.ts")).toBe(
      "vscode://file/home/ada/.office/worktrees/admin/task-1/src/ble/link.ts",
    );
  });

  it("escapes what a URL can't hold in a path", () => {
    expect(editorLink("D:\\My Projects\\wt", "notes #1?.md")).toBe(
      "vscode://file/D:/My%20Projects/wt/notes%20%231%3F.md",
    );
  });
});
