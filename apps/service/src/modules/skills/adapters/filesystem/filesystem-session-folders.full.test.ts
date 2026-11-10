import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("removes what else a session's folder holds, such as the conversation an engine keeps", async () => {
    await folders.write("s-1", [tdd]);
    await writeFile(join(officeData, "sessions", "s-1", "conversation.json"), "{}");

    await folders.remove("s-1");

    expect(await readdir(join(officeData, "sessions"))).toEqual([]);
  });

  it("prunes the folders of sessions it isn't told to keep, and what a crash left", async () => {
    await folders.write("s-1", [tdd]);
    await folders.write("s-2", [tdd]);
    await mkdir(join(officeData, "sessions", "s-1", ".writing-left-by-a-crash"));

    await folders.prune((sessionId) => sessionId === "s-2");

    expect(await readdir(join(officeData, "sessions"))).toEqual(["s-2"]);
  });
});
