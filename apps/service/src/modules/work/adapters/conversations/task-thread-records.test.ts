import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPEN_DECISION_TOOL } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASKING_INSTRUCTIONS } from "../../domain/asking.js";
import { ProjectWorktrees } from "../../ports/project-worktrees.js";
import { StageResults } from "../../ports/stage-results.js";
import { ProjectWorktreesForTests, StageResultsForTests } from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { ASKING_OFFICE_TOOLS } from "./task-thread-records.js";
import { aPersonsThread, taskThreads } from "../../task-thread-records.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-planning-setup-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

const { aTaskIn, setups } = taskThreads(() => work);

describe("a person's Thread on a Task's session", () => {
  it("reads the Task's worktree with read-only tools, briefed from the record", async () => {
    const task = await aTaskIn("waiting-on-you");
    const results = work.app.get(StageResults) as StageResultsForTests;
    results.results.set(`${task.id}/oscar`, {
      lines: ["- Implement (Agent): done. Fixed it."],
      handoverNotes: ["Left: the logout page."],
    });
    const worktrees = work.app.get(ProjectWorktrees) as ProjectWorktreesForTests;
    worktrees.changes.set(task.id, "2 files changed");

    const setup = await setups().of(aPersonsThread(task.id, "oscar"));

    expect(setup).toMatchObject({
      folder: join("/worktrees", task.projectId, task.id),
      instructions: ASKING_INSTRUCTIONS,
      officeTools: ASKING_OFFICE_TOOLS,
      asking: true,
      sessionRefusal: undefined,
    });
    expect(setup.brief).toContain("Fix the login redirect");
    expect(setup.brief).toContain("- Implement (Agent): done. Fixed it.");
    expect(setup.brief).toContain("2 files changed");
    expect(setup.brief).toContain("Left: the logout page.");
  });

  it("gives no read-write tool, and no Decision", () => {
    expect(ASKING_OFFICE_TOOLS).toEqual(
      expect.not.arrayContaining([
        OPEN_DECISION_TOOL,
        "write_plan",
        "write_definition_of_done",
        "propose_pipeline",
        "write_tags",
      ]),
    );
  });
});
