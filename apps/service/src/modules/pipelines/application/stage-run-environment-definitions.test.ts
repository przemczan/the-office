import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../engine/index.fixtures.js";
import type { OfficeToolResult } from "../../engine/index.js";
import {
  aDoneResult,
  anAgentStage,
  anAgentSession,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import type { RunEnvironmentDefinitionFile } from "../ports/run-environment-definitions.js";
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
});
