import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { aSkillFile } from "../../domain/skill.fixtures.js";
import { skillFilesHash } from "../../domain/skill-files.js";
import { SkillVersionMissing } from "../../domain/skill-version-missing.js";
import { FilesystemLibraryFolder } from "./filesystem-library-folder.js";

let officeData: string;
let library: FilesystemLibraryFolder;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-library-"));
  library = new FilesystemLibraryFolder(new OfficeDataDirectory(officeData));
});

afterEach(async () => {
  await rm(officeData, { recursive: true, force: true });
});

const files = [
  aSkillFile("SKILL.md", "---\nname: tdd\ndescription: Test first.\n---\n"),
  aSkillFile("scripts/run.sh", "#!/bin/sh\n"),
];

function versionFolder(filesHash: string): string {
  return join(officeData, "skills", "tdd", filesHash);
}

describe("FilesystemLibraryFolder", () => {
  it("keeps a version's files in the skill's folder, under their files hash", async () => {
    const filesHash = await library.keep("tdd", files);

    expect(filesHash).toBe(skillFilesHash(files));
    expect(await readdir(join(officeData, "skills", "tdd"))).toEqual([filesHash]);
    await expect(library.read("tdd", filesHash)).resolves.toEqual(files);
  });

  it("refuses to write outside the skill's folder", async () => {
    await expect(library.keep("tdd", [aSkillFile("../escaped", "")])).rejects.toThrow(
      `A skill's files stay inside its folder; "../escaped" is not inside.`,
    );
    await expect(library.keep("../tdd", files)).rejects.toThrow(
      `"../tdd" can't name a skill's folder.`,
    );
    expect(await readdir(join(officeData, "skills", "tdd"))).toEqual([]);
  });

  describe("read", () => {
    it("refuses a link in the version's folder", async () => {
      const filesHash = await library.keep("tdd", files);
      // A junction on Windows, which needs no privilege there; a link elsewhere.
      await symlink(officeData, join(versionFolder(filesHash), "elsewhere"), "junction");

      await expect(library.read("tdd", filesHash)).rejects.toThrow(
        new SkillVersionMissing("tdd", filesHash, `"elsewhere" is not a regular file.`),
      );
    });
  });
});
