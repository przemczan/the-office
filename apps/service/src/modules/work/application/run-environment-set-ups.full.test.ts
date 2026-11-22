import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KnownProjectsForTests } from "../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../work-application.fixtures.js";
import { RunEnvironmentSetUps } from "./run-environment-set-ups.js";
import { ANN_LEE } from "../domain/work.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-set-ups-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

describe("RunEnvironmentSetUps.add", () => {
  it("refuses the set-up Task when the Project lacks a command its Pipeline runs, naming it, making none", async () => {
    const projectId = `project-${randomUUID()}`;
    work.app
      .get(KnownProjectsForTests)
      .commands.set(projectId, [{ key: "build", name: "Build", commandLine: "npm run build" }]);

    expect(await work.app.get(RunEnvironmentSetUps).add(projectId, ANN_LEE)).toEqual({
      outcome: "refused",
      reasons: [
        `The Pipeline Set up run environment runs test, which The ${projectId} has no command for. Add it on the Project page, or choose another Pipeline.`,
      ],
    });
    expect(await work.app.get(RunEnvironmentSetUps).openOf(projectId)).toBeUndefined();
  });
});
