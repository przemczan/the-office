import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { ClaudeCodeEngine } from "../../domain/engines.js";
import { engineConfigFolder } from "../engine-folders/engine-config-folder.js";
import { forgetSessionFiles } from "./session-forget.js";

const SESSION_ID = "5d1c7a3e-0f2b-4c8e-9a61-7b2e3f4a5c6d";
const OTHER_ID = "9a8b7c6d-1111-4222-8333-444455556666";

const WORK: ClaudeCodeEngine = {
  id: "work",
  name: "Work",
  kind: "claude-code",
  defaultModel: "claude-sonnet-5-5",
  defaultEffort: null,
  claudeCodeP: false,
};

let officeData: OfficeDataDirectory;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "office-forget-"));
  officeData = new OfficeDataDirectory(root);
});

afterEach(() => rm(root, { recursive: true, force: true }));

/** The files of the session `id`, and of the engine's other things, as the binary leaves them. */
async function aSession(id: string): Promise<void> {
  const folder = engineConfigFolder(officeData, WORK.id);
  for (const project of ["-worktrees-a", "-worktrees-b"]) {
    await mkdir(join(folder, "projects", project, id, "subagents"), { recursive: true });
    await writeFile(join(folder, "projects", project, `${id}.jsonl`), "{}\n");
    await writeFile(join(folder, "projects", project, id, "subagents", "agent-1.jsonl"), "{}\n");
  }
  await mkdir(join(folder, "todos"), { recursive: true });
  await writeFile(join(folder, "todos", `${id}-agent-${id}.json`), "[]");
}

describe("forgetting a Claude Code session's files", () => {
  it("removes its transcripts, their folders and its todo lists, and leaves every other session's", async () => {
    await aSession(SESSION_ID);
    await aSession(OTHER_ID);

    await forgetSessionFiles(officeData, SESSION_ID, WORK);

    const folder = engineConfigFolder(officeData, WORK.id);
    const left = await readdir(folder, { recursive: true });
    expect(left.filter((path) => path.includes(SESSION_ID))).toEqual([]);
    expect(left.filter((path) => path.includes(OTHER_ID)).length).toBeGreaterThan(0);
  });

  it("does nothing for an engine with no folder or a session it holds nothing of", async () => {
    await expect(forgetSessionFiles(officeData, SESSION_ID, WORK)).resolves.toBeUndefined();
    await aSession(OTHER_ID);
    await expect(forgetSessionFiles(officeData, SESSION_ID, WORK)).resolves.toBeUndefined();
  });

  it("never follows an id that isn't a session's", async () => {
    await aSession(OTHER_ID);

    await forgetSessionFiles(officeData, "../..", WORK);

    const folder = engineConfigFolder(officeData, WORK.id);
    expect((await readdir(folder, { recursive: true })).length).toBeGreaterThan(0);
  });
});
