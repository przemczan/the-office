import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDIT_TOOL } from "./edit-tool.js";
import { READ_TOOL } from "./read-tool.js";
import { folder, run, files, setUpEachTest } from "./file-tools.fixtures.js";

setUpEachTest();

describe("Read", () => {
  it("numbers a file's lines, from an offset and up to a limit", async () => {
    await files({ "notes.txt": "one\r\ntwo\r\nthree\r\n" });

    expect(await run(READ_TOOL, { file_path: "notes.txt" })).toEqual({
      text: "     1\tone\n     2\ttwo\n     3\tthree",
      isError: false,
    });
    expect((await run(READ_TOOL, { file_path: "notes.txt", offset: 2, limit: 1 })).text).toBe(
      "     2\ttwo\n(Lines 2–2 of 3; read on with offset 3.)",
    );
  });
});

describe("Edit", () => {
  it("edits only a file read before", async () => {
    await files({ "notes.txt": "draft" });

    expect(
      await run(EDIT_TOOL, { file_path: "notes.txt", old_string: "draft", new_string: "final" }),
    ).toMatchObject({ isError: true, text: expect.stringContaining("read it before editing it") });

    await run(READ_TOOL, { file_path: "notes.txt" });
    await run(EDIT_TOOL, { file_path: "notes.txt", old_string: "draft", new_string: "final" });
    expect(await readFile(join(folder, "notes.txt"), "utf8")).toBe("final");
  });
});
