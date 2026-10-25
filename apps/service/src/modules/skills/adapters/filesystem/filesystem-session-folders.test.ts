import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("writes a folder with no skill as the plugin alone", async () => {
    const folder = await folders.write("s-1", []);

    expect(await readdir(folder)).toEqual([".claude-plugin"]);
  });

  it("writes the folder afresh, dropping what was there", async () => {
    const folder = await folders.write("s-1", [tdd]);
    await writeFile(join(folder, "skills", "tdd", "SKILL.md"), "edited by an Agent");
    await writeFile(join(folder, "stray.md"), "");

    await folders.write("s-1", [tdd]);

    expect(await readFile(join(folder, "skills", "tdd", "SKILL.md"), "utf8")).toBe("Red.");
    expect((await readdir(folder)).toSorted()).toEqual([".claude-plugin", "skills"]);
    expect(await readdir(join(officeData, "sessions", "s-1"))).toEqual(["skills"]);
  });

  it("removes a session's folder, and its own folder once empty", async () => {
    await folders.write("s-1", [tdd]);

    await folders.remove("s-1");
    await folders.remove("s-2");

    expect(await readdir(join(officeData, "sessions"))).toEqual([]);
  });

  it("keeps what else a session's folder holds", async () => {
    await folders.write("s-1", [tdd]);
    await writeFile(join(officeData, "sessions", "s-1", "other"), "");

    await folders.remove("s-1");

    expect(await readdir(join(officeData, "sessions", "s-1"))).toEqual(["other"]);
  });

  it("prunes the folders of sessions it isn't told to keep, and what a crash left", async () => {
    await folders.write("s-1", [tdd]);
    await folders.write("s-2", [tdd]);
    await mkdir(join(officeData, "sessions", "s-1", ".writing-left-by-a-crash"));

    await folders.prune((sessionId) => sessionId === "s-2");

    expect(await readdir(join(officeData, "sessions"))).toEqual(["s-2"]);
  });

  it("refuses a session id that would lead out of the sessions folder", async () => {
    await expect(folders.write("../s", [])).rejects.toThrow(
      `"../s" can't name a session's folder.`,
    );
  });
});
