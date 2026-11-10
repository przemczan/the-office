import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { aSkillFile } from "../../domain/skill.fixtures.js";
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
  it("keeps each version beside the others", async () => {
    const first = await library.keep("tdd", files);
    const second = await library.keep("tdd", [aSkillFile("SKILL.md", "changed")]);

    expect((await readdir(join(officeData, "skills", "tdd"))).toSorted()).toEqual(
      [first, second].toSorted(),
    );
    await expect(library.read("tdd", first)).resolves.toEqual(files);
  });

  it("changes nothing when it keeps the same files again, even at once", async () => {
    const [first, second] = await Promise.all([
      library.keep("tdd", files),
      library.keep("tdd", files.toReversed()),
    ]);

    expect(second).toBe(first);
    expect(await readdir(join(officeData, "skills", "tdd"))).toEqual([first]);
  });

  describe("read", () => {
    it("throws SkillVersionMissing for files it never kept", async () => {
      await expect(library.read("tdd", "a".repeat(64))).rejects.toThrow(SkillVersionMissing);
    });

    it("throws SkillVersionMissing when the files changed since", async () => {
      const filesHash = await library.keep("tdd", files);
      await writeFile(join(versionFolder(filesHash), "SKILL.md"), "edited");

      await expect(library.read("tdd", filesHash)).rejects.toThrow(
        new SkillVersionMissing("tdd", filesHash, "its files have changed since."),
      );
    });
  });

  describe("prune", () => {
    it("removes the versions it isn't told to keep, and what an interrupted keep left", async () => {
      const kept = await library.keep("tdd", files);
      const dropped = await library.keep("tdd", [aSkillFile("SKILL.md", "older")]);
      await mkdir(join(officeData, "skills", "tdd", ".writing-left-by-a-crash"));

      await library.prune((skillName, filesHash) => skillName === "tdd" && filesHash === kept);

      expect(await readdir(join(officeData, "skills", "tdd"))).toEqual([kept]);
      await expect(library.read("tdd", dropped)).rejects.toThrow(SkillVersionMissing);
    });

    it("removes the folder of a skill with no version left", async () => {
      await library.keep("tdd", files);
      await library.keep("notes", [aSkillFile("SKILL.md", "Notes.")]);

      await library.prune((skillName) => skillName === "notes");

      expect(await readdir(join(officeData, "skills"))).toEqual(["notes"]);
    });

    it("does nothing before the library has a skill", async () => {
      await expect(library.prune(() => false)).resolves.toBeUndefined();
    });
  });
});
