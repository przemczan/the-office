import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskSchema } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskThreadSetups } from "../../../conversations/index.js";
import { PLANNING_INSTRUCTIONS, PLANNING_OFFICE_TOOLS } from "../../domain/planning.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

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

describe("a planning Thread's session", () => {
  it("works in the Task's worktree with the Project's environment and skills, briefed from the record", async () => {
    const projectId = `project-${randomUUID()}`;
    const created = await sendJson(work, "POST", "/tasks", {
      title: "Fix the login redirect",
      projectId,
      priority: "normal",
    });
    const task = taskSchema.parse(await created.json());

    const setup = await work.app
      .get(TaskThreadSetups)
      .of({ threadId: randomUUID(), taskId: task.id, roleKey: "planner" });

    expect(setup).toEqual({
      folder: join("/worktrees", projectId, task.id),
      environment: { PROJECT: projectId },
      useProjectSkills: true,
      instructions: PLANNING_INSTRUCTIONS,
      officeTools: PLANNING_OFFICE_TOOLS,
      brief: expect.stringContaining(`Fix the login redirect (Task ${task.id})`),
    });
    expect(setup.brief).toContain("- install: `npm install`");
  });
});
