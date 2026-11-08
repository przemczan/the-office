import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { anOfficeToolCall } from "../../engine/index.fixtures.js";
import type { OfficeToolResult } from "../../engine/index.js";
import { AlarmSounded, TaskPaused, TaskStopped } from "../../work/index.js";
import {
  AN_INTERRUPTED_SESSION,
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import type { AgentCommand } from "../domain/agent-command.js";
import { aCommandRun } from "../ports/pipelines-ports.fixtures.js";
import { StageProjectCommands } from "./stage-project-commands.js";

const SESSION = "the-stage's-session";
const call = anOfficeToolCall(SESSION);
const implement = anAgentStage("implement", { name: "Implement" });

let pipelines: PipelinesApplication;
let closed = false;

afterEach(async () => {
  if (!closed) await pipelines.app.close();
  closed = false;
});

function tool(): StageProjectCommands {
  return pipelines.app.get(StageProjectCommands, { strict: false });
}

/** Walks one Stage whose Agent runs `command` as its turn ends, and returns what it was answered. */
async function ranDuringTheStage(
  command: AgentCommand,
  toolCall = call,
): Promise<OfficeToolResult> {
  const taskId = randomUUID();
  pipelines.stageThreads.taskOfSession.set(SESSION, taskId);
  let answer: OfficeToolResult | undefined;
  pipelines.stageThreads.whileWorking = async () => {
    answer = await tool().inSession(command, toolCall);
  };
  await walkStages(pipelines, [implement], taskId);
  if (!answer) throw new Error("The Stage's turn didn't run.");
  return answer;
}

/** What the Agent asked as its turn ran: the answer, and how many commits there were as it came. */
interface StillRunning {
  answer: Promise<OfficeToolResult> | undefined;
  commitsByThen: number | undefined;
}

/**
 * Has the Agent start a command that runs until it is stopped, as the Stage's first turn runs;
 * once it runs, `then` acts on the Task, and the turn goes on.
 */
function runsUntilStoppedDuringTheTurn(
  taskId: string,
  then: () => Promise<void> = () => Promise.resolve(),
): StillRunning {
  pipelines.stageThreads.taskOfSession.set(SESSION, taskId);
  pipelines.commands.agentCommandRunsUntilStopped = true;
  const asked: StillRunning = { answer: undefined, commitsByThen: undefined };
  pipelines.stageThreads.whileTurnRuns = async () => {
    pipelines.stageThreads.whileTurnRuns = undefined;
    const started = new Promise<void>((resolve) => {
      pipelines.commands.agentCommandStarted = resolve;
    });
    const answer = tool().inSession({ key: "test" }, call);
    asked.answer = answer.finally(() => {
      asked.commitsByThen = pipelines.git.commits.length;
    });
    await started;
    void then();
  };
  return asked;
}

async function stopped(asked: StillRunning): Promise<OfficeToolResult> {
  if (!asked.answer) throw new Error("The Agent's command didn't start.");
  return asked.answer;
}

describe("StageProjectCommands", () => {
  it("refuses a session on no running Stage, in words that say why", async () => {
    pipelines = await startPipelinesApplication();

    await expect(
      tool().inSession({ key: "test" }, anOfficeToolCall("a chat's session")),
    ).resolves.toEqual({
      text: "This tool works in a running Agent Stage of a Task, and this session is in none.",
      isError: true,
    });
    expect(pipelines.commands.agentCommands).toEqual([]);
  });

  it("runs one of the Project's commands by its key and answers its exit code and the file with its whole output", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);

    const answer = await ranDuringTheStage({ key: "test" });

    const [ran] = pipelines.commands.agentCommands;
    expect(ran?.command).toEqual({ key: "test" });
    expect(ran?.outputFile.startsWith(call.outputFolder)).toBe(true);
    expect(answer).toEqual({
      text: `The test command \`npm run test\` passed, exit code 0, in 1 s. Its whole output is in ${ran?.outputFile}; read it with Read.`,
      isError: false,
    });
    await expect(readFile(ran?.outputFile ?? "", "utf8")).resolves.toBe("1 passed");
  });

  it("runs a command line the session's rules allow, and answers the lines that tell why it failed", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    pipelines.commands.agentCommandEnds.push({
      kind: "ran",
      run: aCommandRun("npm test -- src/a.test.ts", "failed", "1 failed: expected 2"),
    });
    const judged: string[] = [];
    const judging = anOfficeToolCall(SESSION, (commandLine) => {
      judged.push(commandLine);
      return { allowed: true };
    });

    const answer = await ranDuringTheStage({ commandLine: "npm test -- src/a.test.ts" }, judging);

    expect(judged).toEqual(["npm test -- src/a.test.ts"]);
    const [ran] = pipelines.commands.agentCommands;
    expect(ran?.command).toEqual({ commandLine: "npm test -- src/a.test.ts" });
    expect(answer).toEqual({
      text: `\`npm test -- src/a.test.ts\` failed, exit code 1, in 1 s. Its whole output is in ${ran?.outputFile}; read it with Read.\n\nWhat tells why:\n\`\`\`\n1 failed: expected 2\n\`\`\``,
      isError: false,
    });
  });

  it("runs no command line the session's rules refuse, and answers in the refusal's words", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const refusal = "Not allowed in this session: running commands other than read-only git.";
    const readOnly = anOfficeToolCall(SESSION, () => ({ allowed: false, reason: refusal }));

    const answer = await ranDuringTheStage({ commandLine: "npm test" }, readOnly);

    expect(answer).toEqual({ text: refusal, isError: true });
    expect(pipelines.commands.agentCommands).toEqual([]);
  });

  it("doesn't judge one of the Project's commands by its key: its settings name it", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const readOnly = anOfficeToolCall(SESSION, () => ({ allowed: false, reason: "Refused." }));

    const answer = await ranDuringTheStage({ key: "build" }, readOnly);

    expect(answer.isError).toBe(false);
    expect(pipelines.commands.agentCommands.map(({ command }) => command)).toEqual([
      { key: "build" },
    ]);
  });

  it("refuses a key the Project has no command for, in words that say why", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    pipelines.commands.agentCommandEnds.push({ kind: "no-command" });

    const answer = await ranDuringTheStage({ key: "lint" });

    expect(answer).toEqual({
      text: "The Project has no lint command: its settings leave it empty, so nothing ran. Run a command line instead, if you may.",
      isError: true,
    });
  });

  it("answers that the command didn't run when the install before it failed", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    pipelines.commands.agentCommandEnds.push({
      kind: "install-failed",
      run: aCommandRun("npm ci", "failed", "npm ERR! missing lockfile"),
    });

    const answer = await ranDuringTheStage({ key: "test" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toMatch(
      /^The test command didn't run: the install before it, `npm ci`, failed, exit code 1/,
    );
    expect(answer.text).toContain("npm ERR! missing lockfile");
  });
});

describe("A command an Agent runs through The Office", () => {
  it("is stopped as its Stage ends with its result, before the Stage commits", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    const asked = runsUntilStoppedDuringTheTurn(taskId);

    await walkStages(pipelines, [implement], taskId);

    const answer = await stopped(asked);
    expect(answer.text).toContain("was stopped by The Office, with everything it started");
    expect(asked.commitsByThen).toBe(0);
    expect(pipelines.git.commits).toHaveLength(1);
    expect((await runsOf(pipelines, taskId))[0]?.outcome?.status).toBe("done");
  });

  it("is stopped when the user stops the Stage", async () => {
    pipelines = await startPipelinesApplication([AN_INTERRUPTED_SESSION]);
    const taskId = randomUUID();
    const asked = runsUntilStoppedDuringTheTurn(taskId, async () => {
      pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
      await pipelines.app.get(EventBus).publish(new TaskStopped(taskId, "in-progress"));
    });

    await walkStages(pipelines, [implement], taskId);

    expect((await stopped(asked)).text).toContain("was stopped by The Office");
    expect((await runsOf(pipelines, taskId))[0]?.outcome).toMatchObject({ interrupted: "stop" });
  });

  it("is stopped as a Stage the user paused is held after the turn", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    const asked = runsUntilStoppedDuringTheTurn(taskId, async () => {
      pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
      await pipelines.app.get(EventBus).publish(new TaskPaused(taskId, "in-progress"));
    });

    await walkStages(pipelines, [implement], taskId);

    expect((await stopped(asked)).text).toContain("was stopped by The Office");
    expect((await runsOf(pipelines, taskId))[0]?.outcome).toMatchObject({ interrupted: "pause" });
    expect(pipelines.git.commits).toEqual([]);
  });

  it("is stopped at once when the fire alarm sounds, while the Agent's turn goes on", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    let turnEnded = false;
    let stoppedBeforeTheTurnEnded = false;
    const asked = runsUntilStoppedDuringTheTurn(taskId, async () => {
      void asked.answer?.finally(() => {
        stoppedBeforeTheTurnEnded = !turnEnded;
      });
      pipelines.tasks.fireAlarmOn = true;
      await pipelines.tasks.pauseForAlarm(taskId);
      await pipelines.app
        .get(EventBus)
        .publish(new AlarmSounded(new Date(), new Date(Date.now() + 60_000)));
    });
    pipelines.stageThreads.whileWorking = async () => {
      await asked.answer;
      turnEnded = true;
    };

    await walkStages(pipelines, [implement], taskId);

    expect((await stopped(asked)).text).toContain("was stopped by The Office");
    expect(stoppedBeforeTheTurnEnded).toBe(true);
    expect((await runsOf(pipelines, taskId))[0]?.outcome).toMatchObject({ interrupted: "alarm" });
  });

  it("is stopped when The Office shuts down during the Stage", async () => {
    pipelines = await startPipelinesApplication([AN_INTERRUPTED_SESSION]);
    const taskId = randomUUID();
    let shutDown: Promise<void> | undefined;
    const asked = runsUntilStoppedDuringTheTurn(taskId, () => {
      shutDown = pipelines.app.close();
      closed = true;
      return shutDown;
    });

    await walkStages(pipelines, [implement], taskId);
    await shutDown;

    expect((await stopped(asked)).text).toContain("was stopped by The Office");
    expect(pipelines.git.commits).toEqual([]);
  });

  it("is refused once its Stage has ended", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    pipelines.stageThreads.taskOfSession.set(SESSION, taskId);
    await walkStages(pipelines, [implement], taskId);

    await expect(tool().inSession({ key: "test" }, call)).resolves.toMatchObject({
      isError: true,
    });
    expect(pipelines.commands.agentCommands).toEqual([]);
  });
});
