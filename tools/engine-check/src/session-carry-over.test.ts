import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { carrySessionBetweenFolders, folderRewrite } from "./session-carry-over.ts";

test("carries a session's transcript, its folder and its todos, naming the new folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "engine-check-carry-"));
  try {
    const from = join(root, "a");
    const to = join(root, "b");
    const project = join(from, "projects", "-repo");
    await mkdir(join(project, "s-1", "tool-results"), { recursive: true });
    await writeFile(
      join(project, "s-1.jsonl"),
      `${JSON.stringify({ path: join(project, "s-1") })}\n`,
    );
    await writeFile(join(project, "s-1", "tool-results", "t.txt"), "output");
    await mkdir(join(from, "todos"));
    await writeFile(join(from, "todos", "s-1-agent-s-1.json"), "[]");

    assert.equal(await carrySessionBetweenFolders("s-1", from, to), true);

    const carried = join(to, "projects", "-repo");
    assert.equal(
      await readFile(join(carried, "s-1.jsonl"), "utf8"),
      `${JSON.stringify({ path: join(carried, "s-1") })}\n`,
    );
    assert.equal(await readFile(join(carried, "s-1", "tool-results", "t.txt"), "utf8"), "output");
    assert.equal(await readFile(join(to, "todos", "s-1-agent-s-1.json"), "utf8"), "[]");
    assert.equal(await carrySessionBetweenFolders("s-2", from, to), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rewrites a Windows folder inside JSON, and only whole folder names", () => {
  const rewrite = folderRewrite("C:\\o\\engines\\a", "C:\\o\\engines\\b");
  assert.equal(
    rewrite(String.raw`"C:\\o\\engines\\a\\projects"`),
    String.raw`"C:\\o\\engines\\b\\projects"`,
  );
  assert.equal(rewrite(String.raw`"C:\\o\\engines\\ab"`), String.raw`"C:\\o\\engines\\ab"`);
});
