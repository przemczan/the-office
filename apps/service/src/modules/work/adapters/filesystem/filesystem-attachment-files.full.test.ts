import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { FilesystemAttachmentFiles } from "./filesystem-attachment-files.js";

const encoded = (words: string): Uint8Array => new TextEncoder().encode(words);

let folder: string;
let files: FilesystemAttachmentFiles;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-attachment-files-"));
  files = new FilesystemAttachmentFiles(new OfficeDataDirectory(folder));
  await files.save("manual", encoded("old bytes"));
  await files.savePdfText("manual", "old text");
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("FilesystemAttachmentFiles.replace", () => {
  it("puts the new copy in place without the old copy's text, and undo puts both back", async () => {
    const replacement = await files.replace("manual", encoded("new bytes"), undefined);

    expect(await text(await files.open("manual"))).toBe("new bytes");
    await expect(files.openPdfText("manual")).rejects.toMatchObject({ code: "ENOENT" });

    await replacement.undo();

    expect(await text(await files.open("manual"))).toBe("old bytes");
    expect(await text(await files.openPdfText("manual"))).toBe("old text");
    expect(await readdir(join(folder, "attachments"))).toEqual(["manual", "manual.pdf-text"]);
  });

  it("lets the old copy go once kept", async () => {
    const replacement = await files.replace("manual", encoded("new bytes"), "new text");

    await replacement.keep();

    expect(await text(await files.open("manual"))).toBe("new bytes");
    expect(await text(await files.openPdfText("manual"))).toBe("new text");
    expect(await readdir(join(folder, "attachments"))).toEqual(["manual", "manual.pdf-text"]);
  });
});
