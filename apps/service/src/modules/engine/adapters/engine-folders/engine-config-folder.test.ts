import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  engineConfigFolder,
  NotAnEngineConfigFolder,
  removeEngineConfigFolder,
} from "./engine-config-folder.js";
import { officeData, decide, keptFile, setUpEachTest } from "./engine-config-folder.fixtures.js";

setUpEachTest();

describe("the engine's config folder", () => {
  describe("removed with its engine", () => {
    it("never when the id leads outside the engines' folder", async () => {
      const outside = await keptFile(join(officeData.path, "outside"));
      const engines = await keptFile(engineConfigFolder(officeData, "home-account"));

      for (const engineId of ["", ".", "..", "../outside", "home-account/..", outside]) {
        await expect(removeEngineConfigFolder(officeData, engineId)).rejects.toBeInstanceOf(
          NotAnEngineConfigFolder,
        );
      }
      await expect(readFile(outside, "utf8")).resolves.toBe("kept");
      await expect(readFile(engines, "utf8")).resolves.toBe("kept");
    });
  });

  describe("refused to the session's Agent", () => {
    it("while the user's own credentials stay refused", async () => {
      await expect(
        decide("Read", { file_path: join(homedir(), ".claude", ".credentials.json") }),
      ).resolves.toMatchObject({ allowed: false });
    });
  });
});
