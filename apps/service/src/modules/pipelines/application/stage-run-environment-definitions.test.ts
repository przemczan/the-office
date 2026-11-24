import { randomUUID } from "node:crypto";
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
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import type { RunEnvironmentDefinitionFile } from "../ports/run-environment-definitions.js";
import type { TaskConsultation } from "../ports/task-consultations.js";
import { StageRunEnvironmentDefinitions } from "./stage-run-environment-definitions.js";

const SESSION = "the-stage's-session";

const call = anOfficeToolCall(SESSION);

const setUp = anAgentStage("set-up", { name: "Set up" });

const FILES: readonly RunEnvironmentDefinitionFile[] = [
  { path: ".devcontainer/devcontainer.json", text: `{ "dockerComposeFile": "compose.yaml" }` },
  { path: ".devcontainer/compose.yaml", text: "services: {}" },
];

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

function tool(): StageRunEnvironmentDefinitions {
  return pipelines.app.get(StageRunEnvironmentDefinitions, { strict: false });
}

/** Walks one Stage whose Agent writes `files` as its turn ends, and returns what it was answered. */
async function writtenDuringTheStage(
  files: readonly RunEnvironmentDefinitionFile[],
): Promise<OfficeToolResult> {
  const taskId = randomUUID();
  pipelines.stageThreads.taskOfSession.set(SESSION, taskId);
  let answer: OfficeToolResult | undefined;
  pipelines.stageThreads.whileWorking = async () => {
    answer = await tool().inSession(files, call);
  };
  await walkStages(pipelines, [setUp], taskId);
  if (!answer) throw new Error("The Stage's turn didn't run.");
  return answer;
}

const CONSULTANT_SESSION = "the-consultant's-session";

const consultantCall = anOfficeToolCall(CONSULTANT_SESSION);

/** Dwight the Devops, consulted on `taskId` from `askingThreadId`. */
function aConsultation(fields: Partial<TaskConsultation> = {}): TaskConsultation {
  return {
    taskId: randomUUID(),
    decisionId: "the-decision",
    askingThreadId: randomUUID(),
    consultant: { name: "Dwight", roleTitle: "Devops" },
    runEnvironment: true,
    ...fields,
  };
}

/**
 * Walks one Stage that consults, mid-turn, from its own Stage Thread, or from `askingThreadId`
 * when a test gives one, and returns what the Consultant's write was answered.
 */
async function writtenInAConsultation(
  files: readonly RunEnvironmentDefinitionFile[],
  askingThreadId?: string,
): Promise<OfficeToolResult> {
  const taskId = randomUUID();
  let answer: OfficeToolResult | undefined;
  pipelines.stageThreads.whileWorking = async () => {
    const running = (await runsOf(pipelines, taskId)).find(({ outcome }) => !outcome);
    const stageThreadId = running?.threadId;
    if (stageThreadId === undefined) throw new Error("The Stage has no Stage Thread yet.");
    pipelines.consultations.bySession.set(
      CONSULTANT_SESSION,
      aConsultation({ taskId, askingThreadId: askingThreadId ?? stageThreadId }),
    );
    answer = await tool().inSession(files, consultantCall);
  };
  await walkStages(pipelines, [setUp], taskId);
  if (!answer) throw new Error("The Stage's turn didn't run.");
  return answer;
}

describe("StageRunEnvironmentDefinitions", () => {
  it("writes nothing outside a running Agent Stage", async () => {
    pipelines = await startPipelinesApplication();

    const answer = await tool().inSession(FILES, call);

    expect(answer).toEqual({
      text: "This tool works in a running Agent Stage of a Task, and this session is in none.",
      isError: true,
    });
    expect(pipelines.definitions.writes).toEqual([]);
  });

  it("writes a valid definition into the Task's worktree and names the service the checks run in", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);

    const answer = await writtenDuringTheStage(FILES);

    expect(pipelines.definitions.writes).toEqual([
      { worktree: aTaskRecord().worktree.path, files: FILES },
    ]);
    expect(answer).toEqual({
      text: 'The run environment definition is valid; the checks run in the service "app". The Office wrote .devcontainer/devcontainer.json, .devcontainer/compose.yaml into the worktree. It checked the files only, building and starting nothing.',
      isError: false,
    });
  });

  it("answers every problem found, when nothing was written", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    pipelines.definitions.next = {
      written: false,
      problems: [
        'devcontainer.json names no service: set "service" to the one the checks run in.',
        "The compose file .devcontainer/compose.yaml isn't there.",
      ],
    };

    const answer = await writtenDuringTheStage(FILES);

    expect(answer).toEqual({
      text: [
        "The Office wrote nothing: the run environment definition has these problems.",
        '- devcontainer.json names no service: set "service" to the one the checks run in.',
        "- The compose file .devcontainer/compose.yaml isn't there.",
      ].join("\n"),
      isError: true,
    });
  });

  describe("in a Consultation on a Task", () => {
    it("writes and commits the definition for the asking Stage, logging the line its Stage history shows", async () => {
      pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);

      const answer = await writtenInAConsultation(FILES);

      expect(pipelines.definitions.writes).toEqual([]);
      expect(pipelines.definitions.commits).toEqual([
        {
          worktree: aTaskRecord().worktree.path,
          files: FILES,
          message: "Run environment definition, by Dwight (Devops)",
        },
      ]);
      const stageThreadId =
        pipelines.consultations.bySession.get(CONSULTANT_SESSION)?.askingThreadId;
      expect(stageThreadId).toEqual(expect.any(String));
      expect(pipelines.consultations.lines).toEqual([
        {
          threadId: stageThreadId,
          decisionId: "the-decision",
          text: "Run environment definition, by Dwight (Devops): commit 4f2a9c1, .devcontainer/devcontainer.json, .devcontainer/compose.yaml.",
        },
      ]);
      expect(answer).toEqual({
        text: 'The run environment definition is valid; the checks run in the service "app". The Office wrote .devcontainer/devcontainer.json, .devcontainer/compose.yaml and committed them on the Task\'s branch as 4f2a9c1. It checked the files only, building and starting nothing.',
        isError: false,
      });
    });

    it("writes and commits when no Stage of the Task runs, as for a person's Thread on it", async () => {
      pipelines = await startPipelinesApplication();
      const consultation = aConsultation();
      pipelines.consultations.bySession.set(CONSULTANT_SESSION, consultation);

      const answer = await tool().inSession(FILES, consultantCall);

      expect(answer.isError).toBe(false);
      expect(pipelines.definitions.commits).toHaveLength(1);
      expect(pipelines.consultations.lines).toEqual([
        expect.objectContaining({ threadId: consultation.askingThreadId }),
      ]);
    });

    it("leaves the next Stage expecting the commit when a person's Thread on the Task asked", async () => {
      pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
      const taskId = randomUUID();
      await walkStages(pipelines, [setUp], taskId);
      const [finished] = await runsOf(pipelines, taskId);
      expect(finished?.headCommit).toEqual(expect.any(String));
      pipelines.consultations.bySession.set(CONSULTANT_SESSION, aConsultation({ taskId }));

      const answer = await tool().inSession(FILES, consultantCall);

      expect(answer.isError).toBe(false);
      expect((await runsOf(pipelines, taskId)).at(-1)?.headCommit).toBe(
        pipelines.definitions.commit,
      );
    });

    it("refuses a Consultant whose card doesn't have the Run environment capability", async () => {
      pipelines = await startPipelinesApplication();
      pipelines.consultations.bySession.set(
        CONSULTANT_SESSION,
        aConsultation({ runEnvironment: false }),
      );

      const answer = await tool().inSession(FILES, consultantCall);

      expect(answer).toEqual({
        text: "The Office wrote nothing: your Role card doesn't have the Run environment capability, which writing the run environment definition in a Consultation needs.",
        isError: true,
      });
      expect(pipelines.definitions.commits).toEqual([]);
      expect(pipelines.consultations.lines).toEqual([]);
    });

    it("refuses while a Stage runs that isn't the one asking", async () => {
      pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);

      const answer = await writtenInAConsultation(FILES, "a-person's-thread-on-the-task");

      expect(answer).toEqual({
        text: "The Office wrote nothing: another Stage of the Task is running and may change its worktree. Ask again once it has ended.",
        isError: true,
      });
      expect(pipelines.definitions.commits).toEqual([]);
      expect(pipelines.consultations.lines).toEqual([]);
    });

    it("answers every problem of an invalid definition, logging nothing", async () => {
      pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
      pipelines.definitions.next = {
        written: false,
        problems: ["The compose file .devcontainer/compose.yaml isn't there."],
      };

      const answer = await writtenInAConsultation(FILES);

      expect(answer).toEqual({
        text: [
          "The Office wrote nothing: the run environment definition has these problems.",
          "- The compose file .devcontainer/compose.yaml isn't there.",
        ].join("\n"),
        isError: true,
      });
      expect(pipelines.consultations.lines).toEqual([]);
    });
  });
});
