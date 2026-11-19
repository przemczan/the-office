import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import {
  engineConfigFolder,
  engineIdsWithConfigFolders,
  preparedEngineConfigFolder,
  removeEngineConfigFolder,
} from "./engine-config-folder.js";
import {
  officeData,
  configFolder,
  decide,
  keptFile,
  setUpEachTest,
} from "./engine-config-folder.fixtures.js";

setUpEachTest();

const credentials = () => join(configFolder(), ".credentials.json");

describe("the engine's config folder", () => {
  it("lies in the Office data directory, one per engine", () => {
    expect(engineConfigFolder(officeData, "work-account")).toBe(
      join(officeData.path, "engines", "work-account"),
    );
  });

  it("is made when missing, and kept as it is when there", async () => {
    const folder = await preparedEngineConfigFolder(officeData, FIRST_CLAUDE_CODE_ENGINE.id);

    expect((await stat(folder)).isDirectory()).toBe(true);
    await expect(preparedEngineConfigFolder(officeData, FIRST_CLAUDE_CODE_ENGINE.id)).resolves.toBe(
      folder,
    );
  });

  // Windows has no file modes: the folder takes the data directory's access list.
  it.skipIf(currentOperatingSystem().name === "Windows")("is the owner's only", async () => {
    const folder = await preparedEngineConfigFolder(officeData, FIRST_CLAUDE_CODE_ENGINE.id);

    expect((await stat(folder)).mode & 0o777).toBe(0o700);
  });

  it("lists the engines with a folder, none before the engines' folder is made", async () => {
    await expect(engineIdsWithConfigFolders(officeData)).resolves.toEqual([]);
    await keptFile(engineConfigFolder(officeData, "work-account"));
    await keptFile(engineConfigFolder(officeData, "home-account"));
    await writeFile(join(officeData.folder("engines"), "stray.txt"), "");

    expect((await engineIdsWithConfigFolders(officeData)).toSorted()).toEqual([
      "home-account",
      "work-account",
    ]);
  });

  describe("removed with its engine", () => {
    it("with everything in it, leaving the other engines' folders", async () => {
      const removed = await keptFile(engineConfigFolder(officeData, "work-account"));
      const other = await keptFile(engineConfigFolder(officeData, "home-account"));

      await removeEngineConfigFolder(officeData, "work-account");

      await expect(stat(join(removed, ".."))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(other, "utf8")).resolves.toBe("kept");
      await expect(removeEngineConfigFolder(officeData, "work-account")).resolves.toBeUndefined();
    });
  });

  describe("refused to the session's Agent", () => {
    it("by its path, to the file tools and to commands", async () => {
      await expect(decide("Read", { file_path: credentials() })).resolves.toMatchObject({
        allowed: false,
      });
      await expect(
        decide("Grep", { pattern: "token", path: configFolder() }),
      ).resolves.toMatchObject({ allowed: false });
      await expect(decide("Bash", { command: `cat "${credentials()}"` })).resolves.toMatchObject({
        allowed: false,
      });
    });

    it("through the variable its commands inherit, which names the engine's folder, not the caller's", async () => {
      await expect(
        decide("Bash", { command: 'cat "$CLAUDE_CONFIG_DIR/.credentials.json"' }),
      ).resolves.toMatchObject({
        allowed: false,
        reason: expect.stringContaining("holds the user's secrets or The Office's own files"),
      });
    });

    it.runIf(currentOperatingSystem().name === "Windows")(
      "through PowerShell's variable",
      async () => {
        await expect(
          decide("PowerShell", {
            command: "Get-Content $env:CLAUDE_CONFIG_DIR\\.credentials.json",
          }),
        ).resolves.toMatchObject({ allowed: false });
      },
    );
  });
});
