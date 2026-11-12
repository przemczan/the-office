import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskStateChanged } from "../../work/index.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aTaskRecord, PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { implement, publish } from "../publish-stage.fixtures.js";
import { InitiativeBranchStages } from "./initiative-branch-stages.js";
import { StageInterpreter } from "./stage-interpreter.js";

const BRANCH = "initiative/usage-exports";

/** A Publishing Task's record: its worktree holds the Initiative's branch itself. */
function aPublishingRecord() {
  const record = aTaskRecord();
  return aTaskRecord({
    initiativeBranch: BRANCH,
    publishingTask: true,
    worktree: { ...record.worktree, branch: BRANCH },
  });
}

/** A fix Task's record, publishing into the Initiative's branch. */
function aFixRecord() {
  return aTaskRecord({ initiativeBranch: BRANCH });
}

let pipelines: PipelinesApplication;

/** A Publishing Task's record, its worktree's HEAD on the Initiative's branch as git has it. */
function putPublishingTask(taskId: string, record = aPublishingRecord()): void {
  pipelines.records.put(taskId, record);
  pipelines.git.move(taskId, { commit: PLANNED_COMMIT, branch: BRANCH });
}

afterEach(async () => {
  await pipelines.app.close();
});

async function walk(taskId: string): Promise<void> {
  const interpreter = pipelines.app.get(StageInterpreter);
  interpreter.walkInBackground(taskId);
  await interpreter.walked(taskId);
}

describe("A Publishing Task's Stages", () => {
  it("wait before the next Stage while a blocker is open, and go on once it is Done", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    putPublishingTask(taskId);
    pipelines.tasks.blockers.set(taskId, [{ id: "fix-1", title: "Fix the export" }]);

    await walkStages(pipelines, [implement], taskId);

    expect(await runsOf(pipelines, taskId)).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("in-progress");

    pipelines.tasks.blockers.delete(taskId);
    await pipelines.app.get(EventBus).publish(new TaskStateChanged("fix-1", "in-progress", "done"));
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect((await runsOf(pipelines, taskId)).map(({ outcome }) => outcome?.status)).toEqual([
      "done",
    ]);
  });

  it("push the Initiative's branch after each Stage, a failed push told on the outcome", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const pushed = randomUUID();
    const failing = randomUUID();
    putPublishingTask(pushed);
    putPublishingTask(failing);
    pipelines.git.pushFailures.set(failing, "the remote refused it.");

    await walkStages(pipelines, [implement], pushed);
    await walkStages(pipelines, [implement], failing);

    expect(pipelines.git.pushes).toEqual([pushed, failing]);
    const [run] = await runsOf(pipelines, failing);
    expect(run?.outcome).toMatchObject({ status: "done" });
    expect(run?.outcome?.status === "done" && run.outcome.summary).toContain(
      `The Office couldn't push ${BRANCH} after the Stage: the remote refused it.`,
    );
  });

  it("tell the Agent its worktree holds the Initiative's branch itself and how Publish ships it", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    putPublishingTask(taskId, {
      ...aPublishingRecord(),
      project: { ...aTaskRecord().project, publishingMode: "push-and-pull-request" },
    });

    await walkStages(pipelines, [anAgentStage("implement")], taskId);

    const [opening] = pipelines.stageThreads.requests;
    expect(opening?.record).toContain(
      `Its worktree holds ${BRANCH} itself, the Initiative's whole change in this Project; Publish puts it into main by a pull request from ${BRANCH} into main.`,
    );
  });

  it("are no Task's but its own: the base it takes in is the base branch alone", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    putPublishingTask(taskId);
    pipelines.git.branchUpdates.set(taskId, { kind: "up-to-date" });

    await walkStages(pipelines, [anAgentStage("implement")], taskId);

    const [opening] = pipelines.stageThreads.requests;
    expect(opening?.record).not.toContain(`${BRANCH}, then main`);
  });

  it("tell the next Stage's Agent the branch moved, once a fix Task's Publish moved the worktree", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    putPublishingTask(taskId);
    await walkStages(pipelines, [anAgentStage("implement")], taskId);

    const fixed = "f".repeat(40);
    pipelines.git.move(taskId, { commit: fixed, branch: BRANCH });
    pipelines.git.movesAlongBase.add(taskId);
    await walkStages(pipelines, [anAgentStage("implement"), anAgentStage("review")], taskId);

    const [, review] = pipelines.stageThreads.requests;
    expect(`${review?.record}\n${review?.work}`).toContain(
      `to ${fixed.slice(0, 8)} since the last Stage: read again whatever you read before.`,
    );
    expect((await runsOf(pipelines, taskId)).map(({ outcome }) => outcome?.status)).toEqual([
      "done",
      "done",
    ]);
  });

  it("have their worktree removed once dropped, holding the branch", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    putPublishingTask(taskId);
    pipelines.tasks.put(taskId, {
      state: "ready",
      pipelineId: "for-tests",
      madeFor: "publishing",
    });

    await pipelines.tasks.drop(taskId);

    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
  });
});

describe("A fix Task's Publish into the Initiative's branch", () => {
  it("waits for a running Publishing Task Stage to end", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    pipelines.records.put(taskId, aFixRecord());
    let endStage!: () => void;
    const stageEnds = new Promise<void>((resolve) => (endStage = resolve));
    const running = pipelines.app
      .get(InitiativeBranchStages)
      .holding(aPublishingRecord(), () => stageEnds);

    const walking = walkStages(pipelines, [implement, publish], taskId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(pipelines.publishing.published).toEqual([]);

    endStage();
    await running;
    await walking;
    expect(pipelines.publishing.published.map(({ taskId: id }) => id)).toEqual([taskId]);
  });

  it("doesn't wait for another Project's Initiative's branch", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    pipelines.records.put(taskId, aFixRecord());
    const elsewhere = {
      ...aPublishingRecord(),
      project: { ...aTaskRecord().project, id: randomUUID() },
    };
    void pipelines.app
      .get(InitiativeBranchStages)
      .holding(elsewhere, () => new Promise<void>(() => undefined));

    await walk(taskId);
    await walkStages(pipelines, [implement, publish], taskId);

    expect(pipelines.publishing.published.map(({ taskId: id }) => id)).toEqual([taskId]);
  });
});
