import { describe, expect, it } from "vitest";
import type { ChangedFile } from "@the-office/contracts";
import { diffsOfFiles, editorLink, fileLineWords } from "./changes-words.ts";

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

function changed(path: string, previousPath: string | null = null): ChangedFile {
  return { path, previousPath, lines: { added: 1, removed: 1 }, deleted: false };
}

describe("diffsOfFiles", () => {
  const diff = [
    "diff --git a/one.ts b/one.ts",
    "--- a/one.ts",
    "+++ b/one.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    'diff --git "a/two words.ts" "b/two words.ts"',
    "new file mode 100644",
    "@@ -0,0 +1 @@",
    "+c",
    "diff --git a/old/name.ts b/new/name.ts",
    "similarity index 90%",
    "rename from old/name.ts",
    "rename to new/name.ts",
    "",
  ].join("\n");
  const files = [
    changed("one.ts"),
    changed("two words.ts"),
    changed("new/name.ts", "old/name.ts"),
    changed("three.ts"),
  ];

  it("finds each file's part of the diff", () => {
    const diffs = diffsOfFiles(diff, files);
    expect(diffs.get("one.ts")).toBe(
      "diff --git a/one.ts b/one.ts\n--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-a\n+b\n",
    );
    expect(diffs.get("two words.ts")).toMatch(/^diff --git "a\/two words\.ts".*\+c\n$/s);
    expect(diffs.get("new/name.ts")).toMatch(
      /^diff --git a\/old\/name\.ts .*rename to new\/name\.ts\n$/s,
    );
  });

  it("finds nothing for a file the diff stops before", () => {
    expect(diffsOfFiles(diff, files).has("three.ts")).toBe(false);
    expect(diffsOfFiles("", files).size).toBe(0);
  });

  it("gives each of a few hundred files its own part", () => {
    const paths = Array.from({ length: 400 }, (_, index) => `src/file-${index}.ts`);
    const manyDiffs = paths
      .map(
        (path, index) => `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-${index}\n+${index + 1}\n`,
      )
      .join("");
    const diffs = diffsOfFiles(
      manyDiffs,
      paths.map((path) => changed(path)),
    );
    expect(diffs.size).toBe(paths.length);
    paths.forEach((path, index) => {
      expect(diffs.get(path)).toBe(
        `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-${index}\n+${index + 1}\n`,
      );
    });
  });
});
