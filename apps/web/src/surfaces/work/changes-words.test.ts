import { describe, expect, it } from "vitest";
import { editorLink, fileLineWords } from "./changes-words.ts";

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
