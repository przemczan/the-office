import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { ClaudeCodeEngine } from "../../domain/engines.js";
import { SessionNotCarried } from "../../ports/agent-engine.js";
import { engineConfigFolder } from "../engine-folders/engine-config-folder.js";
import { carrySessionOver, folderRewrite } from "./session-carry-over.js";

const SESSION_ID = "5d1c7a3e-0f2b-4c8e-9a61-7b2e3f4a5c6d";
const PROJECT = "-var-lib-the-office-worktrees-task-1";

const WORK: ClaudeCodeEngine = {
  id: "work",
  name: "Work",
  kind: "claude-code",
  defaultModel: "claude-sonnet-5-5",
  defaultEffort: null,
  claudeCodeP: false,
};
const HOME: ClaudeCodeEngine = { ...WORK, id: "home", name: "Home" };

let officeData: OfficeDataDirectory;
const work = () => engineConfigFolder(officeData, WORK.id);
const home = () => engineConfigFolder(officeData, HOME.id);

/** A line of a transcript naming a saved tool result by its absolute path, as the binary writes it. */
function toolResultLine(folder: string): string {
  const path = join(folder, "projects", PROJECT, SESSION_ID, "tool-results", "toolu_1.txt");
  return `${JSON.stringify({ type: "user", content: `Output saved to ${path}` })}\n`;
}

/** A session as the binary leaves it in `work`'s folder: its transcript, Sub-agent, tool result and todos. */
async function aSessionOnWork(): Promise<void> {
  const project = join(work(), "projects", PROJECT);
  await mkdir(join(project, SESSION_ID, "subagents"), { recursive: true });
  await mkdir(join(project, SESSION_ID, "tool-results"), { recursive: true });
  await writeFile(join(project, `${SESSION_ID}.jsonl`), toolResultLine(work()));
  await writeFile(join(project, SESSION_ID, "subagents", "agent-a1.jsonl"), toolResultLine(work()));
  await writeFile(join(project, SESSION_ID, "tool-results", "toolu_1.txt"), "a large output");
  await mkdir(join(work(), "todos"), { recursive: true });
  await writeFile(join(work(), "todos", `${SESSION_ID}-agent-${SESSION_ID}.json`), "[]");
  await writeFile(join(work(), "todos", "another-session-agent-x.json"), "[]");
  await mkdir(join(work(), "file-history", SESSION_ID), { recursive: true });
  await writeFile(join(work(), "file-history", SESSION_ID, "a@v1"), "kept behind");
}

/** Every file under `folder`, by its path there, with its text. */
async function filesIn(folder: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[path.slice(folder.length + 1).replaceAll("\\", "/")] = await readFile(path, "utf8");
  }
  return files;
}

beforeEach(async () => {
  officeData = new OfficeDataDirectory(await mkdtemp(join(tmpdir(), "office-carry-over-")));
});

afterEach(async () => {
  await rm(officeData.path, { recursive: true, force: true });
});

describe("carrySessionOver, a Claude Code session carried to a Stand-in Engine's folder", () => {
  it("copies the transcript found by its id, the folder beside it and its todos, naming the new folder", async () => {
    await aSessionOnWork();

    await carrySessionOver(officeData, SESSION_ID, WORK, HOME);

    expect(await filesIn(home())).toEqual({
      [`projects/${PROJECT}/${SESSION_ID}.jsonl`]: toolResultLine(home()),
      [`projects/${PROJECT}/${SESSION_ID}/subagents/agent-a1.jsonl`]: toolResultLine(home()),
      [`projects/${PROJECT}/${SESSION_ID}/tool-results/toolu_1.txt`]: "a large output",
      [`todos/${SESSION_ID}-agent-${SESSION_ID}.json`]: "[]",
    });
  });

  it("leaves the session's own folder as it was", async () => {
    await aSessionOnWork();
    const before = await filesIn(work());

    await carrySessionOver(officeData, SESSION_ID, WORK, HOME);

    expect(await filesIn(work())).toEqual(before);
  });

  it("gives the same files when carried again, as a carry cut short is replayed", async () => {
    await aSessionOnWork();
    await carrySessionOver(officeData, SESSION_ID, WORK, HOME);
    const first = await filesIn(home());

    await carrySessionOver(officeData, SESSION_ID, WORK, HOME);

    expect(await filesIn(home())).toEqual(first);
  });

  it("refuses a session the engine holds no transcript of", async () => {
    await mkdir(join(work(), "projects", PROJECT), { recursive: true });

    await expect(carrySessionOver(officeData, SESSION_ID, WORK, HOME)).rejects.toThrow(
      new SessionNotCarried(SESSION_ID, WORK.id),
    );
  });

  it("leaves no partial file when a file can't be put in place", async () => {
    await aSessionOnWork();
    // A folder where the transcript goes, which a file can't be renamed over.
    const transcript = join(home(), "projects", PROJECT, `${SESSION_ID}.jsonl`);
    await mkdir(join(transcript, "in-the-way"), { recursive: true });

    // The file system's refusal of the rename, by its code (EISDIR on Linux).
    await expect(carrySessionOver(officeData, SESSION_ID, WORK, HOME)).rejects.toHaveProperty(
      "code",
    );

    const left = Object.keys(await filesIn(home()));
    expect(left.filter((path) => path.endsWith(".carrying"))).toEqual([]);
  });
});

describe("folderRewrite", () => {
  it("rewrites a folder named as a POSIX path and as a Windows path inside JSON", () => {
    const rewrite = folderRewrite("/data/engines/work", "/data/engines/home");
    expect(rewrite('{"path":"/data/engines/work/projects/p/s/tool-results/t.txt"}')).toBe(
      '{"path":"/data/engines/home/projects/p/s/tool-results/t.txt"}',
    );
    const windows = folderRewrite("C:\\data\\engines\\work", "C:\\data\\engines\\home");
    expect(windows(String.raw`{"path":"C:\\data\\engines\\work\\projects\\p"}`)).toBe(
      String.raw`{"path":"C:\\data\\engines\\home\\projects\\p"}`,
    );
    expect(windows('{"cwd":"C:/data/engines/work/projects"}')).toBe(
      '{"cwd":"C:/data/engines/home/projects"}',
    );
  });

  it("leaves an engine's folder whose name only starts with the carried one's", () => {
    const rewrite = folderRewrite("/data/engines/work", "/data/engines/home");
    expect(rewrite('"/data/engines/work-2/projects"')).toBe('"/data/engines/work-2/projects"');
  });
});
