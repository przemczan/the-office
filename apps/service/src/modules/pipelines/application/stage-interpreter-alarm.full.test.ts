import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  aDoneResult,
  anAgentSession,
  anAskedDecision,
  answerAsked,
  asksOnce,
  A_WAITING_RESULT,
  runsOf,
  walkStages,
} from "../pipelines-application.fixtures.js";
import type { Stage } from "../domain/stage.js";
import { AlarmResumes } from "./alarm-resumes.js";
import { SIGNED_IN_FOR_TESTS } from "../../../platform/http/signed-in-requests.fixtures.js";
import { userOf } from "../../../platform/http/signed-in-requests.js";
import { GateService } from "./gate-service.js";
import {
  implement,
  review,
  HELD,
  open,
  start,
  soundTheAlarm,
  whileTheFirstTurnRuns,
  resume,
  statusesOf,
} from "../stage-interpreter-alarm.fixtures.js";

const ANN = userOf(SIGNED_IN_FOR_TESTS);

const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};
const gate: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

afterEach(async () => {
  await Promise.all(
    [...open].map((pipelines) => {
      open.delete(pipelines);
      return pipelines.app.close();
    }),
  );
});

describe("Sounding the fire alarm", () => {
  it("stops a Script Stage's command at once, its Stage to run again from its start", async () => {
    const pipelines = await start();
    const taskId = randomUUID();
    pipelines.commands.runsUntilStopped = true;
    pipelines.commands.observe = (call) => {
      if (call === "runCommand") void soundTheAlarm(pipelines, taskId);
    };

    await walkStages(pipelines, [tests, review], taskId);

    expect(await runsOf(pipelines, taskId)).toMatchObject([
      { stageKey: "tests", outcome: { status: "failed", error: HELD, interrupted: "alarm" } },
    ]);
    expect(pipelines.git.discarded).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
  });

  it("ends a Script Stage's wait for a free run environment at once, with nothing run", async () => {
    const pipelines = await start();
    const taskId = randomUUID();
    pipelines.commands.waitsUntil = new Promise(() => undefined);
    pipelines.commands.observe = (call) => {
      if (call === "runCommand") void soundTheAlarm(pipelines, taskId);
    };

    await walkStages(pipelines, [tests, review], taskId);

    expect(await runsOf(pipelines, taskId)).toMatchObject([
      {
        stageKey: "tests",
        waitingSince: undefined,
        outcome: { status: "failed", error: HELD, interrupted: "alarm" },
      },
    ]);
    expect(pipelines.commands.ran).toEqual([]);
  });

  it("records an answer to a Task Waiting on you, but nothing walks until the Task resumes", async () => {
    const asked = anAskedDecision();
    const pipelines = await start([
      anAgentSession(A_WAITING_RESULT),
      anAgentSession(aDoneResult()),
    ]);
    asksOnce(pipelines, asked);
    const taskId = await walkStages(pipelines, [implement]);
    await soundTheAlarm(pipelines, taskId);

    await answerAsked(pipelines, taskId, asked, { kind: "option", option: 1 });

    expect(await statusesOf(pipelines, taskId)).toEqual([["implement", "needs-decision"]]);
    expect((await runsOf(pipelines, taskId))[0]?.decisions[0]?.answer).toBeDefined();
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");

    await resume(pipelines, taskId);

    expect(await statusesOf(pipelines, taskId)).toEqual([
      ["implement", "needs-decision"],
      ["implement", "done"],
    ]);
  });

  it("records a Gate action, but nothing walks until the Task resumes", async () => {
    const pipelines = await start([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, [gate, review]);
    await soundTheAlarm(pipelines, taskId);

    await pipelines.app.get(GateService, { strict: false }).continue(taskId, ANN);

    expect(await statusesOf(pipelines, taskId)).toEqual([["look", "done"]]);
    expect((await runsOf(pipelines, taskId))[0]?.gateAction).toEqual({
      kind: "continue",
      byUser: ANN,
    });
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");

    await resume(pipelines, taskId);

    expect(await statusesOf(pipelines, taskId)).toEqual([
      ["look", "done"],
      ["review", "done"],
    ]);
  });
});

describe("What the all clear would resume", () => {
  it("is nothing yet while the held Stage's turn runs, then its session as the Stage would continue it in its Thread", async () => {
    const pipelines = await start([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    const resumes = pipelines.app.get(AlarmResumes, { strict: false });
    let whileStopping: unknown = "unread";
    whileTheFirstTurnRuns(pipelines, async () => {
      await soundTheAlarm(pipelines, taskId);
      whileStopping = await resumes.of(taskId);
    });
    await walkStages(pipelines, [implement, review], taskId);
    pipelines.stageThreads.ahead = {
      move: "resume",
      cacheWarm: true,
      contextTokens: 41_000,
      briefTokens: 3_000,
    };

    const planned = await resumes.of(taskId);

    const [held] = await runsOf(pipelines, taskId);
    expect(whileStopping).toBeUndefined();
    expect(pipelines.stageThreads.askedAhead).toEqual([
      expect.objectContaining({
        taskId,
        declared: undefined,
        previousThreadId: held?.threadId,
      }),
    ]);
    expect(planned).toEqual({
      kind: "continues-warm",
      stageName: "Implement",
      contextTokens: 41_000,
      briefTokens: 0,
      tokens: 4_100,
    });
  });

  it("re-caches a cold context, or starts fresh with a Brief, as the Context policy would", async () => {
    const pipelines = await start([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    whileTheFirstTurnRuns(pipelines, () => soundTheAlarm(pipelines, taskId));
    await walkStages(pipelines, [implement], taskId);
    const resumes = pipelines.app.get(AlarmResumes, { strict: false });

    pipelines.stageThreads.ahead = {
      move: "resume",
      cacheWarm: false,
      contextTokens: 12_000,
      briefTokens: 3_000,
    };
    const cold = await resumes.of(taskId);
    pipelines.stageThreads.ahead = {
      move: "fresh",
      cacheWarm: false,
      contextTokens: 48_000,
      briefTokens: 3_000,
    };
    const fresh = await resumes.of(taskId);

    expect(cold).toMatchObject({ kind: "re-caches", contextTokens: 12_000, tokens: 12_000 });
    expect(fresh).toMatchObject({ kind: "fresh", briefTokens: 3_000, tokens: 3_000 });
  });

  it("runs a Script Stage's script again, with no model call", async () => {
    const pipelines = await start();
    const taskId = randomUUID();
    pipelines.commands.runsUntilStopped = true;
    pipelines.commands.observe = (call) => {
      if (call === "runCommand") void soundTheAlarm(pipelines, taskId);
    };
    await walkStages(pipelines, [tests, review], taskId);

    const planned = await pipelines.app.get(AlarmResumes, { strict: false }).of(taskId);

    expect(planned).toEqual({
      kind: "script",
      stageName: "Tests",
      contextTokens: 0,
      briefTokens: 0,
      tokens: 0,
    });
    expect(pipelines.stageThreads.askedAhead).toEqual([]);
  });
});
