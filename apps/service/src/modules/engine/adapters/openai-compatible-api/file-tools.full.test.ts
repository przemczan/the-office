import { readFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { editedContent } from "./edit-tool.js";
import { GLOB_TOOL } from "./glob-tool.js";
import { GREP_TOOL } from "./grep-tool.js";
import { READ_TOOL } from "./read-tool.js";
import { WRITE_TOOL } from "./write-tool.js";
import { folder, run, files, setUpEachTest } from "./file-tools.fixtures.js";

setUpEachTest();

describe("Read", () => {
  it("says what's wrong with a file it can't read", async () => {
    await files({ "empty.txt": "", "data.bin": "a\u0000b" });

    expect(await run(READ_TOOL, { file_path: "missing.txt" })).toEqual({
      text: "missing.txt does not exist.",
      isError: true,
    });
    expect((await run(READ_TOOL, { file_path: "empty.txt" })).text).toContain("empty");
    expect(await run(READ_TOOL, { file_path: "data.bin" })).toMatchObject({ isError: true });
    expect(await run(READ_TOOL, { file_path: "." })).toMatchObject({ isError: true });
  });
});

describe("Write", () => {
  it("creates a file with its folders, and overwrites one only once it was read", async () => {
    await files({ "kept.txt": "old" });

    expect(await run(WRITE_TOOL, { file_path: "new/deep/file.txt", content: "hi" })).toMatchObject({
      isError: false,
    });
    expect(await readFile(join(folder, "new/deep/file.txt"), "utf8")).toBe("hi");
    expect(await run(WRITE_TOOL, { file_path: "kept.txt", content: "new" })).toMatchObject({
      isError: true,
      text: expect.stringContaining("read it before writing it"),
    });

    await run(READ_TOOL, { file_path: "kept.txt" });
    await run(WRITE_TOOL, { file_path: "kept.txt", content: "new" });
    expect(await readFile(join(folder, "kept.txt"), "utf8")).toBe("new");
  });
});

describe("Edit", () => {
  it("replaces text that is there once, or every time with replace_all", () => {
    const options = { new_string: "B", replace_all: false };

    expect(editedContent("a x a", { ...options, old_string: "x" })).toBe("a B a");
    expect(editedContent("a x a", { ...options, old_string: "a" })).toEqual({
      problem: expect.stringContaining("found 2 times"),
    });
    expect(editedContent("a x a", { ...options, old_string: "a", replace_all: true })).toBe(
      "B x B",
    );
    expect(editedContent("a x a", { ...options, old_string: "y" })).toEqual({
      problem: "old_string was not found in the file.",
    });
    expect(editedContent("a $& a", { ...options, old_string: "$&", new_string: "$1" })).toBe(
      "a $1 a",
    );
  });

  it("matches a model's line endings to a file's Windows ones", () => {
    expect(
      editedContent("one\r\ntwo\r\n", {
        old_string: "one\ntwo",
        new_string: "1\n2",
        replace_all: false,
      }),
    ).toBe("1\r\n2\r\n");
  });
});

describe("Glob", () => {
  it("lists what a pattern matches, the most recently changed first, leaving out what the session can't read", async () => {
    await files({
      "src/old.ts": "",
      "src/new.ts": "",
      "src/private/key.ts": "",
      "node_modules/lib/index.ts": "",
      "README.md": "",
    });
    await utimes(join(folder, "src/old.ts"), new Date(2020, 0, 1), new Date(2020, 0, 1));

    const listed = await run(GLOB_TOOL, { pattern: "**/*.ts" });

    expect(listed.text.split("\n")).toEqual([
      join(folder, "src", "new.ts"),
      join(folder, "src", "old.ts"),
    ]);
    expect((await run(GLOB_TOOL, { pattern: "*.ts", path: "src" })).text).toContain("new.ts");
    expect(await run(GLOB_TOOL, { pattern: "*.py" })).toEqual({
      text: "No files found",
      isError: false,
    });
  });
});

describe("Grep", () => {
  beforeEach(async () => {
    await files({
      "src/a.ts": "const one = 1;\nconst two = 2;\nconst three = 3;\n",
      "src/b.js": "let One = 1;\n",
      "src/private/c.ts": "const one = 'hidden';\n",
      "notes.md": "nothing here\n",
    });
  });

  it("lists the files that match, by default", async () => {
    const found = await run(GREP_TOOL, { pattern: "one" });

    expect(found.text.split("\n")).toEqual(["Found 1 files", join(folder, "src", "a.ts")]);
    expect((await run(GREP_TOOL, { pattern: "one", "-i": true })).text).toContain("b.js");
  });

  it("shows matching lines with their numbers and the lines around them", async () => {
    const found = await run(GREP_TOOL, {
      pattern: "two",
      output_mode: "content",
      "-B": 1,
      path: "src/a.ts",
    });

    const file = join(folder, "src", "a.ts");
    expect(found.text).toBe(`${file}-1-const one = 1;\n${file}:2:const two = 2;`);
  });

  it("counts, filters by glob and type, and pages", async () => {
    expect((await run(GREP_TOOL, { pattern: "const", output_mode: "count" })).text).toContain(
      `${join(folder, "src", "a.ts")}:3`,
    );
    expect((await run(GREP_TOOL, { pattern: "=", glob: "*.js" })).text).toContain("b.js");
    expect((await run(GREP_TOOL, { pattern: "=", type: "ts" })).text).not.toContain("b.js");
    expect(
      (await run(GREP_TOOL, { pattern: "const", output_mode: "content", head_limit: 1 })).text,
    ).toContain("(2 more not shown");
  });

  it("says when the pattern isn't a regular expression or nothing matches", async () => {
    expect(await run(GREP_TOOL, { pattern: "(" })).toMatchObject({ isError: true });
    expect(await run(GREP_TOOL, { pattern: "absent" })).toEqual({
      text: "No matches found",
      isError: false,
    });
  });
});
