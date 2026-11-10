import { describe, expect, it } from "vitest";
import { SkillRefused } from "../../domain/skill-refused.js";
import { UPLOAD_LIMITS, uploadTooLarge } from "../../domain/skill-upload.js";
import { YauzlZipReader } from "./yauzl-zip-reader.js";
import { aZip, madeOnWindows } from "./zip.fixtures.js";

const reader = new YauzlZipReader();
const text = (value: string) => new Uint8Array(Buffer.from(value));

describe("YauzlZipReader", () => {
  it("reads files and folders with their paths", async () => {
    const zip = await aZip([
      { file: "SKILL.md", text: "Notes." },
      { folder: "scripts" },
      { file: "scripts/run.sh", text: "#!/bin/sh\n" },
    ]);

    await expect(reader.entries(zip)).resolves.toEqual([
      { kind: "file", path: "SKILL.md", content: text("Notes.") },
      { kind: "folder", path: "scripts/" },
      { kind: "file", path: "scripts/run.sh", content: text("#!/bin/sh\n") },
    ]);
  });

  it("tells a link by its Unix mode, without reading it", async () => {
    const zip = await aZip([{ link: "secrets", target: "/etc" }]);

    await expect(reader.entries(zip)).resolves.toEqual([{ kind: "link", path: "secrets" }]);
  });

  it("tells a link from a zip made on Windows by its reparse point attribute", async () => {
    const zip = madeOnWindows(await aZip([{ file: "junction", text: "" }]), 0x400 | 0x10);

    await expect(reader.entries(zip)).resolves.toEqual([{ kind: "link", path: "junction" }]);
  });

  it("reads a zip made on Windows, folders by their attribute", async () => {
    const zip = madeOnWindows(
      await aZip([{ file: "SKILL.md", text: "x" }, { folder: "docs" }]),
      0x20,
    );

    await expect(reader.entries(zip)).resolves.toEqual([
      { kind: "file", path: "SKILL.md", content: text("x") },
      { kind: "folder", path: "docs/" },
    ]);
  });

  it("leaves a path out of the folder for the library to refuse", async () => {
    const zip = await aZip([{ file: "SKILL.md", text: "x" }]);
    const renamed = Buffer.from(zip);
    // yazl refuses such a name, so it is written over one of the same length.
    for (
      let at = renamed.indexOf("SKILL.md");
      at !== -1;
      at = renamed.indexOf("SKILL.md", at + 1)
    ) {
      renamed.write("../SK.md", at);
    }

    await expect(reader.entries(new Uint8Array(renamed))).resolves.toEqual([
      { kind: "file", path: "../SK.md", content: text("x") },
    ]);
  });

  it("refuses what is no zip", async () => {
    await expect(reader.entries(text("not a zip"))).rejects.toThrow(
      new SkillRefused(["The upload is no zip that can be read."]),
    );
  });

  it("refuses a zip holding more than an upload may", async () => {
    const zip = await aZip([{ file: "big.md", text: "x".repeat(UPLOAD_LIMITS.bytes + 1) }]);

    await expect(reader.entries(zip)).rejects.toThrow(new SkillRefused([uploadTooLarge()]));
  });

  it("refuses a zip of more files than an upload may", async () => {
    const zip = await aZip(
      Array.from({ length: UPLOAD_LIMITS.files + 1 }, (_, index) => ({
        file: `${index}.md`,
        text: "",
      })),
    );

    await expect(reader.entries(zip)).rejects.toThrow(new SkillRefused([uploadTooLarge()]));
  });
});
