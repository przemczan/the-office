import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import {
  engineConfigFolder,
  NotAnEngineConfigFolder,
  preparedEngineConfigFolder,
  removeEngineConfigFolder,
} from "./engine-config-folder.js";
import { claudeCodeOfficeRules } from "./session-office-rules.js";

const SESSION_ID = "0b0e6a47-3f9e-4f8e-9a51-2a3c4d5e6f70";

let officeData: OfficeDataDirectory;

const configFolder = () => engineConfigFolder(officeData, FIRST_CLAUDE_CODE_ENGINE.id);
const credentials = () => join(configFolder(), ".credentials.json");

function decide(tool: string, input: unknown) {
  const worktree = join(officeData.path, "worktrees", "task-1");
  const options: SessionOptions = {
    folder: worktree,
    // A folder the session may read, so only the engine's folder replacing it refuses the read.
    environment: { CLAUDE_CONFIG_DIR: worktree },
    engine: FIRST_CLAUDE_CODE_ENGINE,
    model: "claude-haiku-5-5",
    effort: "medium",
    skills: undefined,
    profile: { edit: true, run: { kind: "anything" }, web: true, mcpTools: {} },
    officeTools: [],
    mcpServers: [],
    instructions: "",
    outputSchema: undefined,
  };
  const rules = claudeCodeOfficeRules(
    currentOperatingSystem(),
    officeData,
    { sessionId: SESSION_ID, configFolder: configFolder() },
    options,
  );
  return toolDecision(rules, {}, tool, input);
}

/** A file that must outlive every removal but its own folder's. */
async function keptFile(folder: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  const file = join(folder, "keep.txt");
  await writeFile(file, "kept");
  return file;
}

beforeEach(async () => {
  officeData = new OfficeDataDirectory(await mkdtemp(join(tmpdir(), "office-engine-folder-")));
});

afterEach(async () => {
  await rm(officeData.path, { recursive: true, force: true });
});

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

  describe("removed with its engine", () => {
    it("with everything in it, leaving the other engines' folders", async () => {
      const removed = await keptFile(engineConfigFolder(officeData, "work-account"));
      const other = await keptFile(engineConfigFolder(officeData, "home-account"));

      await removeEngineConfigFolder(officeData, "work-account");

      await expect(stat(join(removed, ".."))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(other, "utf8")).resolves.toBe("kept");
      await expect(removeEngineConfigFolder(officeData, "work-account")).resolves.toBeUndefined();
    });

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

    it("while the user's own credentials stay refused", async () => {
      await expect(
        decide("Read", { file_path: join(homedir(), ".claude", ".credentials.json") }),
      ).resolves.toMatchObject({ allowed: false });
    });
  });
});
