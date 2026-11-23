import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { StageRunsFile } from "../domain/stage-runs-file.js";
import { StageRunsFiles } from "./stage-runs-files.js";

function aFile(title: string): StageRunsFile {
  return {
    version: 1,
    task: { id: "task-1", title, project: "the-office" },
    route: { from: "tests", to: "review", times: 0, limit: null },
    definitionOfDone: [],
    stageRuns: [],
  };
}

async function files(): Promise<{ files: StageRunsFiles; officeData: OfficeDataDirectory }> {
  const officeData = new OfficeDataDirectory(await mkdtemp(join(tmpdir(), "office-stage-runs-")));
  return { files: new StageRunsFiles(officeData), officeData };
}

describe("StageRunsFiles", () => {
  it("writes the Task's file in its own folder under the Office data directory", async () => {
    const { files: stageRunsFiles, officeData } = await files();

    const path = await stageRunsFiles.write("task-1", aFile("Add routes"));

    expect(path).toBe(join(officeData.path, "stage-runs", "task-1", "stage-runs.json"));
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(aFile("Add routes"));
  });

  it("replaces the file by a rename, so a mount of its folder reads the new one", async () => {
    const { files: stageRunsFiles } = await files();
    const path = await stageRunsFiles.write("task-1", aFile("First"));
    const first = await stat(path);

    await stageRunsFiles.write("task-1", aFile("Second"));

    expect((await stat(path)).ino).not.toBe(first.ino);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ task: { title: "Second" } });
    expect(await readdir(dirname(path))).toEqual(["stage-runs.json"]);
  });

  it("removes the Task's folder, and nothing when there is none", async () => {
    const { files: stageRunsFiles, officeData } = await files();
    await stageRunsFiles.write("task-1", aFile("Add routes"));

    await stageRunsFiles.remove("task-1");
    await stageRunsFiles.remove("task-2");

    expect(await readdir(join(officeData.path, "stage-runs"))).toEqual([]);
  });
});
