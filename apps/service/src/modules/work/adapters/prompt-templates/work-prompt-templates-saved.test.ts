import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CALLING_RULE } from "../../../conversations/index.js";
import { READ_ONLY_SHELL_RULE } from "../../../engine/index.js";
import { PromptTemplates } from "../../../prompt-templates/index.js";
import {
  PromptTemplateRepository,
  PromptTemplateRepositoryForTests,
} from "../../../prompt-templates/index.fixtures.js";
import { TaskRecords } from "../../application/task-records.js";
import {
  PLANNING_BRIEF,
  PLANNING_INSTRUCTIONS,
  TASK_WHO_ASKED,
} from "../../domain/work-prompt-templates.js";
import { aPersonsThread, taskThreads } from "../../task-thread-records.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";

const ADA = { userId: "user-ada", name: "Ada Park" };

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-work-prompts-"));
  // Versions of its own: every test file shares the database.
  work = await startWorkApplication(officeData, [
    { provide: PromptTemplateRepository, useValue: new PromptTemplateRepositoryForTests() },
  ]);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

const { aTaskIn, setups } = taskThreads(() => work);

function templates(): PromptTemplates {
  return work.app.get(PromptTemplates);
}

describe("a saved text of a Work prompt template", () => {
  it("changes the planning session's instructions and Brief, and Reset to default brings them back", async () => {
    const task = await aTaskIn("planning");
    const planning = aPersonsThread(task.id, "planner");
    const before = await setups().of(planning);

    await templates().save(
      PLANNING_INSTRUCTIONS.key,
      "Plan with care; {{readOnlyShellRule}}.",
      ADA,
    );
    await templates().save(PLANNING_BRIEF.key, "Plan {{taskTitle}} (Task {{taskId}}).", ADA);
    const saved = await setups().of(planning);

    expect(saved.instructions).toBe(`Plan with care; ${READ_ONLY_SHELL_RULE}.\n\n${CALLING_RULE}`);
    expect(saved.brief).toContain(`Plan Fix the login redirect (Task ${task.id}).`);
    expect(saved.brief).not.toContain("## The Project's commands");

    await templates().resetToDefault(PLANNING_INSTRUCTIONS.key, ADA);
    await templates().resetToDefault(PLANNING_BRIEF.key, ADA);
    const reset = await setups().of(planning);

    expect(reset.instructions).toBe(before.instructions);
    expect(reset.brief).toBe(before.brief);
  });

  it("changes the Who asked an Agent Stage reads, and Reset to default brings it back", async () => {
    const task = await aTaskIn("in-progress");
    const records = work.app.get(TaskRecords);
    const before = (await records.read(task.id)).whoAskedSection;

    await templates().save(TASK_WHO_ASKED.key, "## Who asked\n\n{{createdBy}} asked.", ADA);
    const saved = (await records.read(task.id)).whoAskedSection;
    await templates().resetToDefault(TASK_WHO_ASKED.key, ADA);
    const reset = (await records.read(task.id)).whoAskedSection;

    expect(before).toMatch(/^## Who asked\n\nThe Task was created by /);
    expect(saved).toMatch(/^## Who asked\n\n.+ asked\.$/);
    expect(reset).toBe(before);
  });
});
