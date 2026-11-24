import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  processOutputSchema,
  subAgentMessagesSchema,
  subAgentsAndProcessesSchema,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../../engine/index.js";
import { BusyWorkModule } from "../../../office-updates/index.js";
import { SubAgentsAndProcesses } from "../../application/sub-agents-and-processes.js";
import { SessionStops } from "../../application/session-stops.js";
import { aThread } from "../../domain/thread.fixtures.js";
import type { Thread } from "../../domain/thread.js";
import { NO_MASK } from "../../ports/project-output-masks.js";
import { SubAgentAndProcessRepository } from "../../ports/sub-agent-and-process-repository.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { PostgresSubAgentAndProcessRepository } from "../postgres/postgres-sub-agent-and-process-repository.js";
import { PostgresThreadRepository } from "../postgres/postgres-thread-repository.js";
import { SubAgentsAndProcessesController } from "./sub-agents-and-processes.controller.js";

let app: INestApplication;
let url: string;
let thread: Thread;

beforeAll(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule, BusyWorkModule],
    controllers: [SubAgentsAndProcessesController],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: SubAgentAndProcessRepository, useClass: PostgresSubAgentAndProcessRepository },
      SubAgentsAndProcesses,
      SessionStops,
    ],
  }));
  const sessionId = randomUUID();
  thread = aThread({
    id: randomUUID(),
    home: { kind: "task", taskId: randomUUID() },
    session: {
      id: sessionId,
      roleKey: "developer",
      cardVersion: 1,
      officeInstructionsVersion: 0,
      engineId: FIRST_CLAUDE_CODE_ENGINE.id,
      startedAt: new Date(),
      lastCallAt: undefined,
      contextTokens: 0,
      startContextTokens: undefined,
      full: false,
      changesAllowed: false,
    },
  });
  await app.get(ThreadRepository).add(thread);
  const following = app.get(SubAgentsAndProcesses).follow({
    threadId: thread.id,
    home: thread.home,
    sessionId,
    folder: "/work",
    mask: NO_MASK,
    subAgentsLabel: "Jim's Sub-agents in a Task's Thread",
  });
  await following.take({
    kind: "sub-agent-started",
    callId: "agent-1",
    engineTaskId: undefined,
    withinToolCall: undefined,
    description: "Look it up",
    agentKind: "Explore",
    prompt: "Find it.",
    background: false,
  });
  await following.take({ kind: "text", text: "Found it.", withinToolCall: "agent-1" });
  await following.take({
    kind: "process-started",
    callId: "bash-1",
    engineTaskId: "b1f9c2e07",
    withinToolCall: undefined,
    commandLine: "npm run dev",
    description: "Serve the app",
  });
  await following.take({ kind: "process-output", callId: "bash-1", text: "one\ntwo\n" });
  await following.take({ kind: "process-output", callId: "bash-1", text: "three\n" });
  await following.take({
    kind: "process-ended",
    callId: "bash-1",
    ending: { state: "failed", reason: "Exited with code 1" },
    exitCode: 1,
  });
});

afterAll(async () => {
  await app.close();
});

function read(path: string): Promise<Response> {
  return fetch(`${url}/api/threads/${thread.id}${path}`);
}

describe("SubAgentsAndProcessesController", () => {
  it("lists the current session's Sub-agents and Processes, without messages or output", async () => {
    const response = await read("/sub-agents-and-processes");

    expect(response.status).toBe(200);
    expect(subAgentsAndProcessesSchema.parse(await response.json())).toMatchObject([
      { kind: "sub-agent", callId: "agent-1", state: "running", lastSequence: 1 },
      {
        kind: "process",
        callId: "bash-1",
        state: "failed",
        ending: { state: "failed", reason: "Exited with code 1" },
        exitCode: 1,
        lastSequence: 2,
      },
    ]);
  });

  it("reads a Sub-agent's messages after a sequence", async () => {
    const response = await read("/sub-agents/agent-1/messages?after=0");

    expect(subAgentMessagesSchema.parse(await response.json())).toMatchObject({
      messages: [{ kind: "text", sequence: 1, text: "Found it." }],
      lastSequence: 1,
      earlierNotKept: 0,
    });
  });

  it("reads a Process's output after a sequence, saying how much earlier output isn't kept", async () => {
    const response = await read("/processes/bash-1/output?after=1");

    expect(processOutputSchema.parse(await response.json())).toEqual({
      chunks: [{ sequence: 2, text: "three\n" }],
      lastSequence: 2,
      earlierNotKept: 0,
    });
  });

  it("answers 404 for one the session hasn't, or of the other kind, and 400 for a bad sequence", async () => {
    expect((await read("/processes/agent-1/output")).status).toBe(404);
    expect((await read("/sub-agents/nobody/messages")).status).toBe(404);
    expect((await read("/processes/bash-1/output?after=-1")).status).toBe(400);
    expect(
      (await fetch(`${url}/api/threads/${randomUUID()}/sub-agents-and-processes`)).status,
    ).toBe(404);
  });
});
