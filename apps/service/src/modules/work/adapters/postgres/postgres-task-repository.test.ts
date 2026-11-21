import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { inReadScope } from "../../../../platform/database/read-scope.js";
import { TaskService } from "../../application/task-service.js";
import { boardOrder } from "../../domain/manual-order.js";
import { taskMatchOf } from "../../domain/search.js";
import type { Priority } from "../../domain/task.js";
import { ANN_LEE, anInitiative } from "../../domain/work.fixtures.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { initiatives, tasks } from "./work.schema.js";
import { toInitiativeRow } from "./work-rows.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-task-repository-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

function repository(): TaskRepository {
  return work.app.get(TaskRepository);
}

async function aTask(projectId: string, title = "Export button", priority: Priority = "normal") {
  return work.app
    .get(TaskService)
    .create({ title, projectId, priority, description: "A long story." }, ANN_LEE);
}

function database(): Database {
  return work.app.get<Database>(DATABASE);
}

/**
 * The Task placed at `order`. The keys given sort below every key The Office makes, so a new
 * Task placed after the greatest key on the shared board is placed as ever.
 */
async function placed(id: string, order: string): Promise<void> {
  await database().update(tasks).set({ order }).where(eq(tasks.id, id));
}

/** The Task Dropped and archived at `when`, as the Archive keeps it. */
async function archivedAt(id: string, when: Date): Promise<void> {
  await database()
    .update(tasks)
    .set({ state: "dropped", endedAt: when, archivedAt: when })
    .where(eq(tasks.id, id));
}

/** The Task with these columns set, as the records The Office keeps would set them. */
async function withColumns(id: string, columns: Partial<typeof tasks.$inferInsert>): Promise<void> {
  await database().update(tasks).set(columns).where(eq(tasks.id, id));
}

/** A new Initiative's id, of no Idea. */
async function anInitiativeId(): Promise<string> {
  const initiative = anInitiative({ id: randomUUID(), originIdeaId: undefined });
  await database().insert(initiatives).values(toInitiativeRow(initiative));
  return initiative.id;
}

async function boardIdsMatching(query: string): Promise<string[]> {
  return idsOf(await repository().onTheBoard(taskMatchOf(query)));
}

function idsOf(read: readonly { readonly id: string }[]): string[] {
  return read.map(({ id }) => id);
}

/** A word no other Task on the shared database holds. */
function aWord(): string {
  return `w${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

describe("PostgresTaskRepository", () => {
  it("reads summaries as the whole Tasks without their long texts", async () => {
    const projectId = `project-${randomUUID()}`;
    const { id } = await aTask(projectId);

    const whole = (await repository().list()).find((task) => task.id === id);
    const [summary] = await repository().inProject(projectId);

    const {
      description,
      plan: _plan,
      definitionOfDone: _definitionOfDone,
      commitMessage: _commitMessage,
      proposedPipeline: _proposedPipeline,
      ...rest
    } = whole!;
    expect(description).toBe("A long story.");
    expect(summary).toEqual(rest);
    expect(summary).not.toHaveProperty("description");
  });

  it("reads the Tasks made for a purpose, of one Project or of all", async () => {
    const projectId = `project-${randomUUID()}`;
    const otherProjectId = `project-${randomUUID()}`;
    const onboard = await aTask(projectId);
    const otherOnboard = await aTask(otherProjectId);
    const plain = await aTask(projectId);
    for (const { id } of [onboard, otherOnboard]) {
      await database().update(tasks).set({ madeFor: "onboard" }).where(eq(tasks.id, id));
    }

    const inProject = await repository().madeFor("onboard", projectId);
    const everywhere = (await repository().madeFor("onboard")).map(({ id }) => id);

    expect(inProject.map(({ id }) => id)).toEqual([onboard.id]);
    expect(everywhere).toEqual(expect.arrayContaining([onboard.id, otherOnboard.id]));
    expect(everywhere).not.toContain(plain.id);
  });

  it("reads the Tasks in the states asked for", async () => {
    const { id } = await aTask(`project-${randomUUID()}`);

    const inBacklog = (await repository().inStates(["backlog"])).map((task) => task.id);
    const inPlanning = (await repository().inStates(["planning"])).map((task) => task.id);

    expect(inBacklog).toContain(id);
    expect(inPlanning).not.toContain(id);
  });

  it("reads every Task once in a read scope, and anew after a write", async () => {
    const projectId = `project-${randomUUID()}`;
    const { id } = await aTask(projectId);

    await inReadScope(async () => {
      const [list, summaries] = [
        await repository().list(),
        await repository().summariesIn(["backlog", "planning"]),
      ];
      expect(await repository().list()).toBe(list);
      expect(await repository().summariesIn(["planning", "backlog"])).toBe(summaries);
      expect(await repository().findAll([id])).toBe(await repository().findAll([id, id]));

      const added = await aTask(projectId, "Import button");

      expect((await repository().list()).map((task) => task.id)).toContain(added.id);
      expect((await repository().summariesIn(["backlog"])).map((task) => task.id)).toContain(
        added.id,
      );
    });
  });

  it("lists the board in its order, by priority then the order key's code units, none archived", async () => {
    const projectId = `project-${randomUUID()}`;
    const low = await aTask(projectId, "Low", "low");
    const lower = await aTask(projectId, "Normal a0");
    const upper = await aTask(projectId, "Normal Zz");
    const longer = await aTask(projectId, "Normal Yzz");
    const high = await aTask(projectId, "High", "high");
    const gone = await aTask(projectId, "Archived", "high");
    // Keys are unique on the board. By code units "Yzz…" < "Zz…" < "a0…"; a collation by
    // language would put "a0…" first.
    const unique = randomUUID().replaceAll("-", "").slice(0, 12);
    for (const [{ id }, order] of [
      [low, `Yzz${unique}1`],
      [lower, `a0${unique}`],
      [upper, `Zz${unique}`],
      [longer, `Yzz${unique}`],
      [high, `a0${unique}1`],
      [gone, `Yzz${unique}2`],
    ] as const) {
      await placed(id, order);
    }
    await archivedAt(gone.id, new Date());

    const board = (await repository().onTheBoard()).filter((task) => task.projectId === projectId);
    const sortedInMemory = (await repository().list())
      .filter((task) => task.projectId === projectId && !task.archivedAt)
      .toSorted(boardOrder);

    expect(board.map(({ title }) => title)).toEqual([
      "High",
      "Normal Yzz",
      "Normal Zz",
      "Normal a0",
      "Low",
    ]);
    expect(board.map(({ id }) => id)).toEqual(sortedInMemory.map(({ id }) => id));
    for (const task of board) {
      expect(task).not.toHaveProperty("description");
      expect(task).not.toHaveProperty("plan");
      expect(task).not.toHaveProperty("definitionOfDone");
    }
  });

  it("lists the board's Tasks matching every word, by title or Plan, none archived", async () => {
    const projectId = `project-${randomUUID()}`;
    const word = aWord();
    const other = aWord();
    const byTitle = await aTask(projectId, `Export ${word}`);
    const byPlan = await aTask(projectId, "Import button");
    const both = await aTask(projectId, `Export ${word} ${other}`);
    const gone = await aTask(projectId, `Export ${word}`);
    await aTask(projectId, "Unrelated");
    await database()
      .update(tasks)
      .set({ plan: `Read the ${word.toUpperCase()} file.` })
      .where(eq(tasks.id, byPlan.id));
    await archivedAt(gone.id, new Date());

    expect(new Set(await boardIdsMatching(word))).toEqual(
      new Set([byTitle.id, byPlan.id, both.id]),
    );
    expect(await boardIdsMatching(`${word} ${other.slice(0, 6)}`)).toEqual([both.id]);
    expect(await boardIdsMatching(aWord())).toEqual([]);
  });

  it("lists the archived Tasks alone, the one archived last first", async () => {
    const projectId = `project-${randomUUID()}`;
    const first = await aTask(projectId, "First archived");
    const last = await aTask(projectId, "Last archived");
    const onTheBoard = await aTask(projectId, "On the board");
    await archivedAt(first.id, new Date("2003-01-01T00:00:00Z"));
    await archivedAt(last.id, new Date("2003-01-02T00:00:00Z"));

    const archived = (await repository().archived()).filter((task) => task.projectId === projectId);

    expect(archived.map(({ id }) => id)).toEqual([last.id, first.id]);
    expect(archived[0]).not.toHaveProperty("description");
    expect((await repository().onTheBoard()).map(({ id }) => id)).toContain(onTheBoard.id);
  });
  it("lists a Project's Tasks on the board in its order, none archived nor of another Project", async () => {
    const projectId = `project-${randomUUID()}`;
    const low = await aTask(projectId, "Low", "low");
    const high = await aTask(projectId, "High", "high");
    const gone = await aTask(projectId, "Archived", "high");
    await aTask(`project-${randomUUID()}`, "Elsewhere", "high");
    await archivedAt(gone.id, new Date());

    const board = await repository().onTheBoardIn(projectId);

    expect(idsOf(board)).toEqual([high.id, low.id]);
    expect(board[0]).not.toHaveProperty("description");
  });

  it("reads a Project's Tasks, archived ones too, and none of another Project", async () => {
    const projectId = `project-${randomUUID()}`;
    const kept = await aTask(projectId);
    const gone = await aTask(projectId);
    await aTask(`project-${randomUUID()}`);
    await archivedAt(gone.id, new Date());

    expect(new Set(idsOf(await repository().inProject(projectId)))).toEqual(
      new Set([kept.id, gone.id]),
    );
  });

  it("reads the Tasks in the states asked for, archived ones too, in the board's order", async () => {
    const projectId = `project-${randomUUID()}`;
    const paused = await aTask(projectId, "Paused", "low");
    const waiting = await aTask(projectId, "Waiting", "high");
    const done = await aTask(projectId, "Done");
    const backlog = await aTask(projectId, "Backlog");
    await withColumns(paused.id, { state: "paused" });
    await withColumns(waiting.id, { state: "waiting-on-you" });
    await archivedAt(done.id, new Date());
    await withColumns(done.id, { state: "done" });

    const read = await repository().summariesIn(["paused", "waiting-on-you", "done"]);
    const ofProject = read.filter((task) => task.projectId === projectId);

    expect(idsOf(ofProject)).toEqual([waiting.id, done.id, paused.id]);
    expect(idsOf(read)).not.toContain(backlog.id);
    expect(ofProject[0]).not.toHaveProperty("description");
  });

  it("reads the finished Tasks still on the board, none archived nor open", async () => {
    const projectId = `project-${randomUUID()}`;
    const done = await aTask(projectId);
    const dropped = await aTask(projectId);
    const archived = await aTask(projectId);
    const open = await aTask(projectId);
    await withColumns(done.id, { state: "done" });
    await withColumns(dropped.id, { state: "dropped" });
    await archivedAt(archived.id, new Date());

    const finished = idsOf(await repository().finishedOnTheBoard());

    expect(finished).toEqual(expect.arrayContaining([done.id, dropped.id]));
    expect(finished).not.toContain(archived.id);
    expect(finished).not.toContain(open.id);
  });

  it("reads the Tasks of the Initiatives asked for, or of every Initiative", async () => {
    const projectId = `project-${randomUUID()}`;
    const [one, other] = [await anInitiativeId(), await anInitiativeId()];
    const ofOne = await aTask(projectId);
    const ofOther = await aTask(projectId);
    const ofNone = await aTask(projectId);
    await withColumns(ofOne.id, { initiativeId: one });
    await withColumns(ofOther.id, { initiativeId: other });

    expect(idsOf(await repository().inInitiatives([one]))).toEqual([ofOne.id]);
    expect(new Set(idsOf(await repository().inInitiatives([one, other])))).toEqual(
      new Set([ofOne.id, ofOther.id]),
    );
    expect(await repository().inInitiatives([])).toEqual([]);
    const every = idsOf(await repository().inInitiatives());
    expect(every).toEqual(expect.arrayContaining([ofOne.id, ofOther.id]));
    expect(every).not.toContain(ofNone.id);
  });

  it("reads the Tasks on the Pipelines asked for", async () => {
    const projectId = `project-${randomUUID()}`;
    const [pipeline, other] = [`pipeline-${randomUUID()}`, `pipeline-${randomUUID()}`];
    const onIt = await aTask(projectId);
    const onOther = await aTask(projectId);
    const onNone = await aTask(projectId);
    await withColumns(onIt.id, { pipelineId: pipeline });
    await withColumns(onOther.id, { pipelineId: other });

    expect(idsOf(await repository().onPipelines([pipeline]))).toEqual([onIt.id]);
    const both = idsOf(await repository().onPipelines([pipeline, other]));
    expect(new Set(both)).toEqual(new Set([onIt.id, onOther.id]));
    expect(both).not.toContain(onNone.id);
    expect(await repository().onPipelines([])).toEqual([]);
  });

  it("reads the Tasks a usage window holds Paused, whatever the engine", async () => {
    const projectId = `project-${randomUUID()}`;
    const byWindow = await aTask(projectId);
    const byAlarm = await aTask(projectId);
    await withColumns(byWindow.id, {
      state: "paused",
      pausedBy: "usage-window",
      usageWindowEngineId: `engine-${randomUUID()}`,
      resumesAt: new Date("2030-01-01T00:00:00Z"),
    });
    await withColumns(byAlarm.id, { state: "paused", pausedBy: "alarm" });

    const paused = await repository().pausedByUsageWindow();

    expect(idsOf(paused)).toContain(byWindow.id);
    expect(idsOf(paused)).not.toContain(byAlarm.id);
    expect(paused.find(({ id }) => id === byWindow.id)?.resumesAt).toEqual(
      new Date("2030-01-01T00:00:00Z"),
    );
  });

  it("reads the Tasks naming a Task: waiting for it, resolving it, its Bugs and its Duplicates", async () => {
    const projectId = `project-${randomUUID()}`;
    const named = await aTask(projectId);
    const waiting = await aTask(projectId);
    const resolving = await aTask(projectId);
    const bug = await aTask(projectId);
    const duplicate = await aTask(projectId);
    const unrelated = await aTask(projectId);
    await withColumns(waiting.id, { blockedBy: [unrelated.id, named.id] });
    await withColumns(resolving.id, { madeFor: "resolve-conflicts", resolvesTaskId: named.id });
    await withColumns(bug.id, { causedByTaskId: named.id });
    await withColumns(duplicate.id, {
      state: "dropped",
      dropReason: "duplicate",
      duplicateOfTaskId: named.id,
    });

    expect(new Set(idsOf(await repository().linkedTo(named.id)))).toEqual(
      new Set([waiting.id, resolving.id, bug.id, duplicate.id]),
    );
    expect(await repository().linkedTo("not-a-task")).toEqual([]);
  });

  it("reads every Tag in use once", async () => {
    const projectId = `project-${randomUUID()}`;
    const [tag, other] = [aWord(), aWord()];
    const one = await aTask(projectId);
    const two = await aTask(projectId);
    await withColumns(one.id, { tags: [tag, other] });
    await withColumns(two.id, { tags: [tag] });

    const inUse = await repository().tagsInUse();

    expect(inUse.filter((each) => each === tag || each === other).toSorted()).toEqual(
      [tag, other].toSorted(),
    );
  });
});
