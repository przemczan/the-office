import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { DecisionAnswered } from "../../conversations/index.js";
import { RoleLetGo } from "../../people/index.js";
import type { Stage } from "../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aPerson } from "../ports/pipelines-ports.fixtures.js";
import { StaffingHoldRepository } from "../ports/staffing-hold-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { TaskStagesService } from "./task-stages-service.js";

const draft = anAgentStage("draft");
const look: Stage = { kind: "gate", key: "look", name: "Look", optional: false };
const deploy = anAgentStage("deploy", { name: "Deploy", role: "devops" });

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

/** A Task that did its first Stage and waits at a Gate, with `rest` still to come. */
async function taskWaitingAtGate(...rest: Stage[]): Promise<string> {
  return walkStages(pipelines, [draft, look, ...rest]);
}

async function lettingGo(roleKey: string): Promise<void> {
  pipelines.people.people.delete(roleKey);
  pipelines.people.letGo.set(roleKey, "Dana");
  const role = { key: roleKey } as ConstructorParameters<typeof RoleLetGo>[0];
  await pipelines.app.get(EventBus).publish(new RoleLetGo(role, new Date()));
}

async function stateOf(taskId: string): Promise<string> {
  return (await pipelines.tasks.read(taskId)).state;
}

const ANN = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };

async function answering(
  taskId: string,
  option: number,
  givenBy: { readonly user?: typeof ANN; readonly answeredBy?: string } = { user: ANN },
): Promise<void> {
  const asked = pipelines.decisions.on(taskId).at(-1);
  if (!asked) throw new Error("No Decision was asked.");
  await pipelines.app.get(EventBus).publish(
    new DecisionAnswered(
      {
        id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
        home: { kind: "task", taskId },
        roleKey: "devops",
        title: "Decision",
        state: "waiting",
        session: undefined,
        override: undefined,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        runningTurnTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        startedAt: new Date(),
        openDecisions: [],
        stageThread: false,
      },
      {
        kind: "form",
        id: asked.id,
        threadId: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
        taskId,
        // The Office asks it.
        roleKey: undefined,
        context: asked.draft.context,
        questions: [
          {
            kind: "choice",
            question: asked.draft.question,
            options: asked.draft.options,
            recommendation: asked.draft.recommendation,
          },
        ],
        attachmentIds: [],
        askedAt: new Date(),
        passedOn: [],
        inStageThread: false,
        answer: {
          kind: "submitted",
          answers: [{ kind: "option", option }],
          ...givenBy,
          answeredAt: new Date(),
        },
      },
      new Date(),
    ),
  );
}

describe("a Task whose next Stage names a Role let go", () => {
  it("is paused by The Office behind a Decision, both saying who was let go", async () => {
    pipelines = await startWithDevops();
    const taskId = await taskWaitingAtGate(deploy);

    await lettingGo("devops");

    expect(await stateOf(taskId)).toBe("paused");
    expect(pipelines.tasks.holds).toEqual([
      {
        taskId,
        reason: expect.stringMatching(
          /^nobody can work its next Stages\. Stage 3 · Deploy: Dana was let go from Devops;/,
        ),
      },
    ]);
    const [asked, ...others] = pipelines.decisions.on(taskId);
    expect(others).toEqual([]);
    expect(asked?.draft.options).toEqual(["Resume the Task", "Drop the Task"]);
    expect(asked?.draft.context).toContain(
      "Stage 3 · Deploy: Dana was let go from Devops; hire Dana back",
    );
  });

  it("leaves a Task that doesn't need the Role, and holds one only once", async () => {
    pipelines = await startWithDevops();
    const needing = await taskWaitingAtGate(deploy);
    const other = await taskWaitingAtGate();

    await lettingGo("devops");
    await lettingGo("devops");

    expect(await stateOf(other)).toBe("waiting-on-you");
    expect(pipelines.decisions.on(other)).toEqual([]);
    expect(pipelines.decisions.on(needing)).toHaveLength(1);
  });

  it("keeps a Task paused by the user behind the Decision too", async () => {
    pipelines = await startWithDevops();
    const taskId = await taskWaitingAtGate(deploy);
    await pipelines.tasks.pause(taskId);

    await lettingGo("devops");

    expect(await stateOf(taskId)).toBe("paused");
    expect(pipelines.tasks.holds).toEqual([]);
    expect(pipelines.decisions.on(taskId)).toHaveLength(1);
  });

  it("is held again, with a new Decision, when resumed while nobody fills the Role", async () => {
    pipelines = await startWithDevops();
    const taskId = await taskWaitingAtGate(deploy);
    await lettingGo("devops");

    await answering(taskId, 0);
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(await stateOf(taskId)).toBe("paused");
    expect(pipelines.decisions.on(taskId)).toHaveLength(2);
  });

  it("goes on when resumed once someone fills the Role", async () => {
    pipelines = await startWithDevops();
    const taskId = await taskWaitingAtGate(deploy);
    await lettingGo("devops");
    pipelines.people.people.set("devops", aPerson("Dev"));
    pipelines.people.letGo.delete("devops");

    await answering(taskId, 0);
    await pipelines.app.get(StageInterpreter).walked(taskId);

    // The walk goes on and waits at the Gate again.
    expect(await stateOf(taskId)).toBe("waiting-on-you");
    expect(pipelines.decisions.on(taskId)).toHaveLength(1);
  });

  it("is dropped by the Drop answer", async () => {
    pipelines = await startWithDevops();
    const taskId = await taskWaitingAtGate(deploy);
    await lettingGo("devops");

    await answering(taskId, 1);

    expect(await stateOf(taskId)).toBe("dropped");
    expect(pipelines.tasks.drops).toEqual([{ taskId, by: { kind: "user", user: ANN } }]);
  });

  it("records a Consultant's Drop answer as theirs, not a user's", async () => {
    pipelines = await startWithDevops();
    const taskId = await taskWaitingAtGate(deploy);
    await lettingGo("devops");

    await answering(taskId, 1, { answeredBy: "cto" });

    expect(pipelines.tasks.drops).toEqual([{ taskId, by: { kind: "person", roleKey: "cto" } }]);
  });

  it("stays held behind the Decision when Work refuses the Drop", async () => {
    pipelines = await startWithDevops();
    const taskId = await taskWaitingAtGate(deploy);
    await lettingGo("devops");
    vi.spyOn(pipelines.tasks, "dropAsAnswered").mockRejectedValueOnce(new Error("Refused."));

    await answering(taskId, 1).catch(() => undefined);

    expect(await stateOf(taskId)).toBe("paused");
    expect(await pipelines.app.get(StaffingHoldRepository).isHeld(taskId)).toBe(true);
  });

  it("is flagged in the editor as let go, not as never hired", async () => {
    pipelines = await startWithDevops();
    const taskId = await taskWaitingAtGate(deploy);
    await lettingGo("devops");

    const problems = await pipelines.app.get(TaskStagesService).staffingProblems(taskId);

    expect(problems.map(({ text }) => text)).toEqual([
      "Stage 3 · Deploy: Dana was let go from Devops; hire Dana back, hire someone else, or choose who works it.",
    ]);
  });
});

/** Ada fills `developer`, and Dev fills `devops` until a test lets them go. */
describe("a Task started with a later Agent Stage whose Role nobody fills", () => {
  it("is held at once, before its first Stage runs, behind the Decision", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);

    const taskId = await walkStages(pipelines, [draft, look, deploy]);

    expect(await stateOf(taskId)).toBe("paused");
    expect(pipelines.engine.sessions).toHaveLength(0);
    expect(pipelines.tasks.holds).toEqual([
      { taskId, reason: expect.stringContaining("Stage 3 · Deploy: nobody fills") },
    ]);
    expect(pipelines.decisions.on(taskId)).toHaveLength(1);
  });

  it("is held again by Resume while the Role stays vacant, and dropped by the Drop answer", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, [draft, look, deploy]);

    await answering(taskId, 0);
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(await stateOf(taskId)).toBe("paused");
    expect(pipelines.decisions.on(taskId)).toHaveLength(2);
    await answering(taskId, 1);
    expect(await stateOf(taskId)).toBe("dropped");
  });
});

async function startWithDevops(): Promise<PipelinesApplication> {
  const started = await startPipelinesApplication([
    anAgentSession(aDoneResult()),
    anAgentSession(aDoneResult()),
  ]);
  started.people.people.set("devops", aPerson("Dev"));
  return started;
}
