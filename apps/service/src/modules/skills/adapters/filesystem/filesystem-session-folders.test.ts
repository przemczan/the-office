import { lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { aSkillFile } from "../../domain/skill.fixtures.js";
import { FilesystemSessionFolders } from "./filesystem-session-folders.js";

let officeData: string;
let folders: FilesystemSessionFolders;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-sessions-"));
  folders = new FilesystemSessionFolders(new OfficeDataDirectory(officeData));
});

afterEach(async () => {
  await rm(officeData, { recursive: true, force: true });
});

const tdd = {
  name: "tdd",
  files: [aSkillFile("SKILL.md", "Red."), aSkillFile("scripts/run.sh", "#!/bin/sh\n")],
};

describe("FilesystemSessionFolders", () => {
  it("writes the plugin's manifest and a regular-file copy of each skill", async () => {
    const folder = await folders.write("s-1", [
      tdd,
      { name: "notes", files: [aSkillFile("SKILL.md", "N.")] },
    ]);

    expect(folder).toBe(join(officeData, "sessions", "s-1", "skills"));
    expect(
      JSON.parse(await readFile(join(folder, ".claude-plugin", "plugin.json"), "utf8")),
    ).toEqual({ name: "office" });
    expect((await readdir(join(folder, "skills"))).toSorted()).toEqual(["notes", "tdd"]);
    expect(await readFile(join(folder, "skills", "tdd", "scripts", "run.sh"), "utf8")).toBe(
      "#!/bin/sh\n",
    );
    expect((await lstat(join(folder, "skills", "tdd", "SKILL.md"))).isFile()).toBe(true);
  });

  it("refuses a session id that would lead out of the sessions folder", async () => {
    await expect(folders.write("../s", [])).rejects.toThrow(
      `"../s" can't name a session's folder.`,
    );
  });
});
