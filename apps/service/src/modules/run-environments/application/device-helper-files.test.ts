import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import {
  DEVICE_HELPER_NOT_BUILT,
  DeviceHelperFiles,
  DeviceHelperSource,
} from "./device-helper-files.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";

let folder: string;
let source: string;
let folders: RunEnvironmentFolders;

function filesFrom(sourceFolder: string | undefined): DeviceHelperFiles {
  return new DeviceHelperFiles(new DeviceHelperSource(sourceFolder), folders);
}

async function build(version: string, architectures: readonly string[]): Promise<void> {
  await mkdir(source, { recursive: true });
  for (const architecture of architectures) {
    await writeFile(
      join(source, `office-device-helper-${architecture}`),
      `binary ${architecture} ${version}`,
    );
  }
  await writeFile(join(source, "version"), version);
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-device-helper-files-"));
  source = join(folder, "dist");
  folders = new RunEnvironmentFolders(new OfficeDataDirectory(join(folder, "office-data")));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("DeviceHelperFiles", () => {
  it("copies both executables and the version into the Office data directory, executable", async () => {
    await build("1.4.0", ["x86_64", "aarch64"]);
    const files = filesFrom(source);

    await files.copy();

    expect((await readdir(folders.deviceHelper)).toSorted()).toEqual([
      "office-device-helper-aarch64",
      "office-device-helper-x86_64",
      "version",
    ]);
    const executable = join(folders.deviceHelper, "office-device-helper-x86_64");
    expect(await readFile(executable, "utf8")).toBe("binary x86_64 1.4.0");
    expect((await stat(executable)).mode & 0o777).toBe(0o755);
    expect(await files.executableFor("x86_64")).toBe(
      "/office-device-helper/office-device-helper-x86_64",
    );
    expect(await files.version()).toBe("1.4.0");
  });

  it("leaves a file already the same as it is, and renames a changed one over it", async () => {
    await build("1.4.0", ["x86_64"]);
    await filesFrom(source).copy();
    const executable = join(folders.deviceHelper, "office-device-helper-x86_64");
    const first = await stat(executable);

    await filesFrom(source).copy();
    expect((await stat(executable)).ino).toBe(first.ino);

    await build("1.5.0", ["x86_64"]);
    await filesFrom(source).copy();
    // A new file, so a helper running from the old one keeps it.
    expect((await stat(executable)).ino).not.toBe(first.ino);
    expect(await readFile(executable, "utf8")).toBe("binary x86_64 1.5.0");
    expect(await readFile(join(folders.deviceHelper, "version"), "utf8")).toBe("1.5.0");
    expect((await readdir(folders.deviceHelper)).filter((name) => name.endsWith(".tmp"))).toEqual(
      [],
    );
  });

  it("answers no executable for a machine it isn't built for, or when nothing is built", async () => {
    await build("1.4.0", ["x86_64"]);
    const built = filesFrom(source);
    await built.copy();
    const notBuilt = filesFrom(join(folder, "missing"));
    await notBuilt.copy();
    const none = filesFrom(undefined);
    await none.copy();

    expect(await built.executableFor("aarch64")).toBeUndefined();
    expect(await notBuilt.executableFor("x86_64")).toBeUndefined();
    expect(await none.executableFor("x86_64")).toBeUndefined();
    expect(await notBuilt.helloProblemOf("1.4.0")).toBe(DEVICE_HELPER_NOT_BUILT);
    expect(DEVICE_HELPER_NOT_BUILT).toBe(
      "The Office device helper isn't built (npm run build:device-helper).",
    );
  });

  it("refuses a helper of another version in the UI's words, and takes its own", async () => {
    await build("1.4.0", ["x86_64"]);
    const files = filesFrom(source);
    await files.copy();

    expect(await files.helloProblemOf("1.3.9")).toBe(
      "The Office device helper is version 1.3.9; this Office is 1.4.0.",
    );
    expect(await files.helloProblemOf("1.4.0")).toBeUndefined();
  });
});
