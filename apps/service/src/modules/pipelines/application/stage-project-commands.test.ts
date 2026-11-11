import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../engine/index.fixtures.js";
import type { OfficeToolResult } from "../../engine/index.js";
import {
  aDoneResult,
  anAgentStage,
  anAgentSession,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import type { AgentCommand } from "../domain/agent-command.js";
import type { Stage } from "../domain/stage.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import { StageProjectCommands } from "./stage-project-commands.js";

const SESSION = "the-stage's-session";

const call = anOfficeToolCall(SESSION);

const implement = anAgentStage("implement", { name: "Implement" });

/** What the Agent asked as its turn ran: the answer, and how many commits there were as it came. */
interface StillRunning {
  answer: Promise<OfficeToolResult> | undefined;
  commitsByThen: number | undefined;
}

async function stopped(asked: StillRunning): Promise<OfficeToolResult> {
  if (!asked.answer) throw new Error("The Agent's command didn't start.");
  return asked.answer;
}

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
  { stage = implement, taskId = randomUUID() }: { stage?: Stage; taskId?: string } = {},
): Promise<OfficeToolResult> {
  pipelines.stageThreads.taskOfSession.set(SESSION, taskId);
  let answer: OfficeToolResult | undefined;
  pipelines.stageThreads.whileWorking = async () => {
    answer = await tool().inSession(command, toolCall);
  };
  await walkStages(pipelines, [stage], taskId);
  if (!answer) throw new Error("The Stage's turn didn't run.");
  return answer;
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

describe("StageProjectCommands", () => {
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

  it("runs no command line the session's rules refuse, and answers in the refusal's words", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const refusal = "Not allowed in this session: running commands other than read-only git.";
    const readOnly = anOfficeToolCall(SESSION, () => ({ allowed: false, reason: refusal }));

    const answer = await ranDuringTheStage({ commandLine: "npm test" }, readOnly);

    expect(answer).toEqual({ text: refusal, isError: true });
    expect(pipelines.commands.agentCommands).toEqual([]);
  });
});

describe("StageProjectCommands in a Stage narrowed to test", () => {
  const narrowed = anAgentStage("implement", { permissions: { commands: ["test"] } });

  /** Walks the narrowed Stage of a Task of the-office, with its two test commands. */
  function ranInTheOffice(command: AgentCommand, toolCall = call): Promise<OfficeToolResult> {
    const taskId = randomUUID();
    const record = aTaskRecord();
    pipelines.records.put(taskId, {
      ...record,
      project: {
        ...record.project,
        commands: [
          { key: "test", name: "Tests", commandLine: "npm run verify" },
          { key: "test-full", name: "Full tests", commandLine: "npm run verify:full" },
        ],
      },
    });
    return ranDuringTheStage(command, toolCall, { stage: narrowed, taskId });
  }

  it("refuses test-full by its key before anything runs, naming what the Stage may run", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);

    const answer = await ranInTheOffice({ key: "test-full" });

    expect(answer).toEqual({
      text: "The test-full command isn't one this Stage may run; it may run test.",
      isError: true,
    });
    expect(pipelines.commands.agentCommands).toEqual([]);
  });

  it("runs test, and install, by their keys", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);

    const test = await ranInTheOffice({ key: "test" });
    const install = await ranInTheOffice({ key: "install" });

    expect(test.isError).toBe(false);
    expect(install.isError).toBe(false);
    expect(pipelines.commands.agentCommands.map(({ command }) => command)).toEqual([
      { key: "test" },
      { key: "install" },
    ]);
  });

  it("judges a command line the Agent writes out as before", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const judged: string[] = [];
    const judging = anOfficeToolCall(SESSION, (commandLine) => {
      judged.push(commandLine);
      return { allowed: true };
    });

    const answer = await ranInTheOffice({ commandLine: "npm run verify:full" }, judging);

    expect(judged).toEqual(["npm run verify:full"]);
    expect(answer.isError).toBe(false);
    expect(pipelines.commands.agentCommands.map(({ command }) => command)).toEqual([
      { commandLine: "npm run verify:full" },
    ]);
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
});
