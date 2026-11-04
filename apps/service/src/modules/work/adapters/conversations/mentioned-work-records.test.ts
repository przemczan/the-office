import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentSchema, ideaSchema, initiativeSchema, taskSchema } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkRecords } from "../../../conversations/index.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-mentioned-records-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

describe("the records of mentioned Tasks, Initiatives and Ideas", () => {
  it("are worded as read_task and read_idea word them", async () => {
    const projectId = `project-${randomUUID()}`;
    const task = taskSchema.parse(
      await (
        await sendJson(work, "POST", "/tasks", {
          title: "Fix the login redirect",
          projectId,
          priority: "high",
        })
      ).json(),
    );
    const idea = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", {
          title: "Dark mode",
          notes: "For the night shift.",
          projectId,
        })
      ).json(),
    );
    const records = work.app.get(WorkRecords);

    const taskRecord = await records.taskRecord(task.id);
    const ideaRecord = await records.ideaRecord(idea.id);

    expect(taskRecord).toMatch(
      /^Fix the login redirect \(Task [\w-]+\)\n- Project [\w-]+; .*high priority/,
    );
    expect(taskRecord).toContain("No Plan yet.");
    expect(ideaRecord).toMatch(/^Dark mode \(Idea [\w-]+\)\n- in the Project [\w-]+; new/);
    expect(ideaRecord).toContain("For the night shift.");
  });

  it("give a Task's own Attachments, of any kind, which a Decision may name", async () => {
    const projectId = `project-${randomUUID()}`;
    const aTask = async (title: string) =>
      taskSchema.parse(
        await (
          await sendJson(work, "POST", "/tasks", { title, projectId, priority: "normal" })
        ).json(),
      );
    const attached = async (taskId: string) =>
      attachmentSchema.parse(
        await (
          await sendJson(work, "POST", `/tasks/${taskId}/attachments/links`, {
            name: "Preview",
            url: "https://example.com/preview",
          })
        ).json(),
      );
    const [task, another] = await Promise.all(["The export", "The import"].map(aTask));
    if (!task || !another) throw new Error("The Tasks weren't created.");
    const own = await attached(task.id);
    await attached(another.id);

    await expect(work.app.get(WorkRecords).taskAttachmentIds(task.id)).resolves.toEqual([own.id]);
  });

  it("name the Tasks a Task waits for, and one dropped as no longer blocking", async () => {
    const projectId = `project-${randomUUID()}`;
    const create = async (title: string) =>
      taskSchema.parse(
        await (
          await sendJson(work, "POST", "/tasks", { title, projectId, priority: "normal" })
        ).json(),
      );
    const [schema, protocol, client] = await Promise.all(
      ["Queue schema", "Sync protocol messages", "Mobile sync client"].map(create),
    );
    for (const blocker of [schema, protocol]) {
      await sendJson(work, "POST", `/tasks/${client?.id}/dependencies`, { blockerId: blocker?.id });
    }
    await sendJson(work, "POST", `/tasks/${protocol?.id}/drop`);

    const record = await work.app.get(WorkRecords).taskRecord(client?.id ?? "");

    expect(record).toContain(
      [
        "Must be Done before it can start:",
        `- Queue schema (Task ${schema?.id}), Backlog`,
        `- Sync protocol messages (Task ${protocol?.id}), Dropped, so it no longer blocks`,
      ].join("\n"),
    );
  });

  it("give an Initiative's record as read_initiative words it", async () => {
    const idea = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", {
          title: "Offline sync",
          notes: "",
          projectId: null,
        })
      ).json(),
    );
    const initiative = initiativeSchema.parse(
      await (await sendJson(work, "POST", `/ideas/${idea.id}/initiative`)).json(),
    );

    const record = await work.app.get(WorkRecords).initiativeRecord(initiative.id);

    expect(record).toMatch(/^Offline sync \(Initiative [\w-]+\)\n- shaping; spans no Project yet/);
  });

  it("are undefined for a record The Office doesn't have", async () => {
    const records = work.app.get(WorkRecords);

    await expect(records.taskRecord(randomUUID())).resolves.toBeUndefined();
    await expect(records.initiativeRecord(randomUUID())).resolves.toBeUndefined();
    await expect(records.ideaRecord(randomUUID())).resolves.toBeUndefined();
  });
});
