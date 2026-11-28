import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Author } from "../domain/author.js";
import { SHAPES_INITIATIVES, NOBODY_SHAPES_INITIATIVES } from "../domain/duties.js";
import { InitiativeCreated, InitiativeStateChanged } from "../domain/initiative-events.js";
import { InitiativeNotShaping } from "../domain/initiative-not-shaping.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import type { Initiative } from "../domain/initiative.js";
import { TaskStateChanged, TaskTitleChanged } from "../domain/task-events.js";
import type { Task } from "../domain/task.js";
import { ANN_LEE } from "../domain/work.fixtures.js";
import { aProjectId } from "../initiatives.controller.fixtures.js";
import { TaskRepository } from "../ports/task-repository.js";
import {
  InitiativeThreadsForTests,
  KnownPeopleForTests,
  UNKNOWN_PROJECT,
} from "../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../work-application.fixtures.js";
import { InitiativeService } from "./initiative-service.js";
import { TaskLocks } from "./task-locks.js";
import { TaskService } from "./task-service.js";

const THE_CTO: Author = { kind: "person", roleKey: "cto" };

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-initiative-service-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
});

afterEach(async () => {
  await work.app.close();
});

function initiatives(): InitiativeService {
  return work.app.get(InitiativeService);
}

/** A name of the test's own: Short names are Office-wide, and every test file shares them. */
function aName(): string {
  return `Usage exports ${randomUUID().slice(0, 8)}`;
}

async function shaping(): Promise<Initiative> {
  const { initiative } = await initiatives().create(
    { name: aName(), outcome: "Every account exports its usage." },
    ANN_LEE,
  );
  return initiative;
}

async function addTask(initiative: Initiative, title = "Export endpoint"): Promise<Task> {
  return initiatives().addTask(
    initiative.id,
    { title, projectId: aProjectId(), priority: "normal" },
    [],
    ANN_LEE,
  );
}

/** An active Initiative on None, with `count` Tasks in Backlog, each in a Project of its own. */
async function active(count: number): Promise<{ initiative: Initiative; tasks: Task[] }> {
  const initiative = await shaping();
  const tasks: Task[] = [];
  for (let index = 0; index < count; index += 1) {
    tasks.push(await addTask(initiative, `Part ${index + 1}`));
  }
  await initiatives().confirm(initiative.id, ANN_LEE);
  return { initiative: await initiatives().read(initiative.id), tasks };
}

/** As the walk ends a Task's work, which this module leaves to Pipelines. */
async function end(task: Task, to: "done" | "dropped"): Promise<void> {
  const { event } = await work.app.get(TaskRepository).update(task.id, (held) => ({
    task: { ...held, state: to },
    event: new TaskStateChanged(held.id, held.state, to),
  }));
  if (event) await work.app.get(EventBus).publish(event);
}

function stateChangesTo(initiative: Initiative): InitiativeStateChanged[] {
  return work.published.filter(
    (event): event is InitiativeStateChanged =>
      event instanceof InitiativeStateChanged && event.initiativeId === initiative.id,
  );
}

describe("InitiativeService.create", () => {
  it("saves the Initiative before InitiativeCreated is told, and opens its shaping Thread with the holder", async () => {
    const found: (string | undefined)[] = [];
    work.app.get(EventBus).subscribe(InitiativeCreated, async ({ initiative }) => {
      found.push((await initiatives().read(initiative.id)).state);
    });

    const { initiative, shaping: opening } = await initiatives().create(
      { name: aName(), outcome: "Every account exports its usage." },
      ANN_LEE,
    );

    expect(initiative.state).toBe("shaping");
    expect(found).toEqual(["shaping"]);
    expect(opening.opened).toBe(true);
    const opened = work.app.get(InitiativeThreadsForTests).opened;
    expect(opened.map(({ initiativeId, roleKey }) => ({ initiativeId, roleKey }))).toEqual([
      { initiativeId: initiative.id, roleKey: opening.shaper?.roleKey },
    ]);
  });

  it("opens no Thread while nobody holds Shapes Initiatives, and starts one once someone does", async () => {
    const people = work.app.get(KnownPeopleForTests);
    people.hold(SHAPES_INITIATIVES, undefined);

    const { initiative, shaping: opening } = await initiatives().create(
      { name: aName(), outcome: "Every account exports its usage." },
      ANN_LEE,
    );

    expect(opening).toEqual({ shaper: undefined, opened: false });
    expect(work.app.get(InitiativeThreadsForTests).opened).toEqual([]);
    await expect(initiatives().startShapingThread(initiative.id)).rejects.toThrow(
      NOBODY_SHAPES_INITIATIVES,
    );

    people.hold(SHAPES_INITIATIVES, "architect");
    await initiatives().startShapingThread(initiative.id);
    expect(work.app.get(InitiativeThreadsForTests).opened.map(({ roleKey }) => roleKey)).toEqual([
      "architect",
    ]);
  });

  it("leaves the Initiative standing when its shaping Thread can't open", async () => {
    work.app.get(InitiativeThreadsForTests).failure = new Error("The engine is down.");

    const { initiative, shaping: opening } = await initiatives().create(
      { name: aName(), outcome: "Every account exports its usage." },
      ANN_LEE,
    );

    expect(opening.opened).toBe(false);
    expect((await initiatives().read(initiative.id)).state).toBe("shaping");
  });
});

describe("InitiativeService.drop", () => {
  it("waits for a Task's lock held by a way back, then drops its open Tasks, telling the Initiative's move first", async () => {
    const { initiative, tasks } = await active(2);
    const [done, open] = tasks as [Task, Task];
    await end(done, "done");
    const order: string[] = [];
    let letGo!: () => void;
    const wayBack = work.app
      .get(TaskLocks)
      .run(open.id, () => new Promise<void>((resolve) => (letGo = resolve)));
    work.published.length = 0;

    const dropping = initiatives()
      .drop(initiative.id, ANN_LEE)
      .then(() => order.push("dropped"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await initiatives().read(initiative.id)).state).toBe("active");
    order.push("let go");
    letGo();
    await wayBack;
    await dropping;

    expect(order).toEqual(["let go", "dropped"]);
    const stored = await work.app.get(TaskService).findAll([done.id, open.id]);
    expect(Object.fromEntries(stored.map(({ id, state }) => [id, state]))).toEqual({
      [done.id]: "done",
      [open.id]: "dropped",
    });
    const told = work.published.filter(
      (event) => event instanceof InitiativeStateChanged || event instanceof TaskStateChanged,
    );
    expect(told.map((event) => event.constructor.name)).toEqual([
      "InitiativeStateChanged",
      "TaskStateChanged",
    ]);
    expect(told[0]).toMatchObject({ from: "active", to: "dropped" });
    expect(told[1]).toMatchObject({ taskId: open.id, to: "dropped" });
  });
});

describe("an Initiative's Tasks ending", () => {
  it("makes an active Initiative done once, when its last two Tasks end at once, a Dropped one not counting", async () => {
    const { initiative, tasks } = await active(3);
    const [first, second, dropped] = tasks as [Task, Task, Task];
    await work.app.get(TaskService).drop(dropped.id, ANN_LEE);
    expect((await initiatives().read(initiative.id)).state).toBe("active");
    work.published.length = 0;

    await Promise.all([end(first, "done"), end(second, "done")]);

    expect((await initiatives().read(initiative.id)).state).toBe("done");
    expect(stateChangesTo(initiative).map(({ to }) => to)).toEqual(["done"]);
    await expect(initiatives().drop(initiative.id, ANN_LEE)).rejects.toThrow(
      "A done Initiative can't be dropped.",
    );
  });

  it("leaves an Initiative being shaped for Confirm, which makes it done at once", async () => {
    const initiative = await shaping();
    const task = await addTask(initiative);
    await end(task, "done");
    expect((await initiatives().read(initiative.id)).state).toBe("shaping");

    const confirmed = await initiatives().confirm(initiative.id, ANN_LEE);

    expect(confirmed.state).toBe("done");
    expect(stateChangesTo(initiative).map(({ to }) => to)).toEqual(["active", "done"]);
  });
});

describe("InitiativeService.choosePipeline", () => {
  it("refuses a Project the Initiative doesn't span and a Pipeline the library lacks, telling nothing", async () => {
    const initiative = await shaping();
    const task = await addTask(initiative);
    const notSpanned = aProjectId();
    work.published.length = 0;

    await expect(
      initiatives().choosePipeline(initiative.id, notSpanned, "quick-fix", "straight"),
    ).rejects.toThrow(
      `The Initiative has no Task in the Project "${notSpanned}", so it has no Pipeline there.`,
    );
    await expect(
      initiatives().choosePipeline(initiative.id, task.projectId, "no-such-pipeline", "straight"),
    ).rejects.toBeInstanceOf(InitiativeRefused);

    expect(work.published).toEqual([]);
    expect((await initiatives().read(initiative.id)).pipelines).toEqual([]);
  });
});

describe("InitiativeService.writeOutcome and applyProposal", () => {
  it("refuses the user's own outcome once active, which an applied Proposal writes, kept as the user's", async () => {
    const { initiative } = await active(1);

    await expect(
      initiatives().writeOutcome(initiative.id, "Exports run nightly.", "straight", ANN_LEE),
    ).rejects.toBeInstanceOf(InitiativeNotShaping);

    const applied = await initiatives().applyProposal(
      initiative.id,
      { kind: "outcome", outcome: "Exports run nightly." },
      THE_CTO,
      ANN_LEE,
    );

    expect(applied).toEqual({ kind: "outcome", outcome: "Exports run nightly." });
    expect((await initiatives().read(initiative.id)).outcome).toBe("Exports run nightly.");
    const history = await initiatives().history(initiative.id);
    expect(history.at(-1)).toMatchObject({ kind: "edit", field: "outcome", by: { kind: "user" } });
  });

  it("adds a Proposal's Task in Backlog once active, created by its proposer, answering its id", async () => {
    const { initiative } = await active(1);
    const projectId = aProjectId();

    const applied = await initiatives().applyProposal(
      initiative.id,
      {
        kind: "add-task",
        title: "Export screen",
        projectId,
        priority: "high",
        blockedBy: [],
        taskId: undefined,
      },
      THE_CTO,
      ANN_LEE,
    );

    expect(applied.kind === "add-task" && applied.taskId).toEqual(expect.any(String));
    const added = await work.app
      .get(TaskService)
      .read(applied.kind === "add-task" ? (applied.taskId ?? "") : "");
    expect(added).toMatchObject({
      title: "Export screen",
      projectId,
      state: "backlog",
      initiativeId: initiative.id,
      createdBy: THE_CTO,
    });
  });

  it("holds a Proposal that changes nothing already, telling nothing", async () => {
    const { initiative, tasks } = await active(1);
    const [task] = tasks as [Task];
    work.published.length = 0;

    await initiatives().applyProposal(
      initiative.id,
      { kind: "task-title", taskId: task.id, title: task.title },
      THE_CTO,
      ANN_LEE,
    );

    expect(work.published.some((event) => event instanceof TaskTitleChanged)).toBe(false);
  });

  it("refuses any Proposal of a done Initiative", async () => {
    const { initiative, tasks } = await active(1);
    await end(tasks[0] as Task, "done");

    await expect(
      initiatives().applyProposal(
        initiative.id,
        { kind: "outcome", outcome: "Exports run nightly." },
        THE_CTO,
      ),
    ).rejects.toThrow("The Initiative is done: it changes no more.");
  });
});

describe("InitiativeService.problemsWithProposal", () => {
  it("answers, never throws, for an Initiative there is none of, a Project there is none of and a cycle", async () => {
    const { initiative, tasks } = await active(2);
    const [first, second] = tasks as [Task, Task];
    await work.app.get(TaskService).addDependency(second.id, first.id);
    const missing = randomUUID();

    expect(
      await initiatives().problemsWithProposal(missing, { kind: "outcome", outcome: "Any." }),
    ).toEqual([`There is no Initiative "${missing}".`]);
    expect(
      await initiatives().problemsWithProposal(initiative.id, {
        kind: "add-task",
        title: "Export screen",
        projectId: UNKNOWN_PROJECT,
        priority: "normal",
        blockedBy: [],
        taskId: undefined,
      }),
    ).toEqual([`There is no Project "${UNKNOWN_PROJECT}".`]);
    expect(
      await initiatives().problemsWithProposal(initiative.id, {
        kind: "add-dependency",
        taskId: first.id,
        blockerId: second.id,
      }),
    ).toEqual([`"Part 2" already waits for "Part 1", so "Part 1" can't wait for it.`]);
    expect(
      await initiatives().problemsWithProposal(initiative.id, {
        kind: "outcome",
        outcome: "Exports run nightly.",
      }),
    ).toEqual([]);
  });
});
