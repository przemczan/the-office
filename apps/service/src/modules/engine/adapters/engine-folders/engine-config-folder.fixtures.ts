import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import { engineConfigFolder } from "./engine-config-folder.js";
import { claudeCodeOfficeRules } from "../claude-code/session-office-rules.js";

// What engine-config-folder.test.ts and engine-config-folder.full.test.ts share.

export const SESSION_ID = "0b0e6a47-3f9e-4f8e-9a51-2a3c4d5e6f70";

export let officeData: OfficeDataDirectory;

export const configFolder = () => engineConfigFolder(officeData, FIRST_CLAUDE_CODE_ENGINE.id);

export function decide(tool: string, input: unknown) {
  const worktree = join(officeData.path, "worktrees", "task-1");
  const options: SessionOptions = {
    deferredOfficeTools: [],
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
    languageServers: [],
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
export async function keptFile(folder: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  const file = join(folder, "keep.txt");
  await writeFile(file, "kept");
  return file;
}

/** The hooks every test of both files runs. */
export function setUpEachTest(): void {
  beforeEach(async () => {
    officeData = new OfficeDataDirectory(await mkdtemp(join(tmpdir(), "office-engine-folder-")));
  });

  afterEach(async () => {
    await rm(officeData.path, { recursive: true, force: true });
  });
}
