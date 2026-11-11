import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import {
  endItem,
  ENDED_ITEMS_KEPT,
  MESSAGES_KEPT,
  OUTPUT_KEPT_BYTES,
  type Process,
  type SubAgent,
} from "../../domain/sub-agents-and-processes.js";
import { aThread } from "../../domain/thread.fixtures.js";
import { PostgresSubAgentAndProcessRepository } from "./postgres-sub-agent-and-process-repository.js";
import { PostgresThreadRepository } from "./postgres-thread-repository.js";

const AT = new Date("2026-11-11T09:00:00.000Z");

let app: INestApplication;
let repository: PostgresSubAgentAndProcessRepository;
let threadId: string;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresThreadRepository, PostgresSubAgentAndProcessRepository],
  }));
  repository = app.get(PostgresSubAgentAndProcessRepository);
  const thread = aThread({ id: randomUUID(), home: { kind: "chat", roleKey: "caps" } });
  await app.get(PostgresThreadRepository).add(thread);
  threadId = thread.id;
});

afterAll(async () => {
  await app.close();
});

function aProcess(sessionId: string, callId = "bash-1", startedAt = AT): Process {
  return {
    kind: "process",
    threadId,
    sessionId,
    callId,
    engineTaskId: "b1f9c2e07",
    startedBy: undefined,
    description: "Serve the app",
    commandLine: "npm run dev",
    ending: undefined,
    exitCode: undefined,
    startedAt,
    endedAt: undefined,
    revision: 0,
    lastSequence: 0,
    earlierOutputNotKept: 0,
  };
}

function aSubAgent(sessionId: string): SubAgent {
  return {
    kind: "sub-agent",
    threadId,
    sessionId,
    callId: "agent-1",
    engineTaskId: undefined,
    startedBy: undefined,
    description: "Look it up",
    agentKind: "Explore",
    prompt: "Find it.",
    background: true,
    ending: undefined,
    reportedBack: undefined,
    toolCallCount: undefined,
    totalTokens: undefined,
    startedAt: AT,
    endedAt: undefined,
    revision: 0,
    lastSequence: 0,
    earlierMessagesNotKept: 0,
  };
}

describe("PostgresSubAgentAndProcessRepository", () => {
  it("keeps an item once, and reads it back as kept", async () => {
    const sessionId = randomUUID();
    const subAgent = aSubAgent(sessionId);

    expect(await repository.add(subAgent)).toBe(true);
    expect(await repository.add({ ...subAgent, description: "Again" })).toBe(false);
    expect(await repository.find(subAgent)).toEqual(subAgent);
    expect(await repository.ofSession(sessionId)).toEqual([subAgent]);
  });

  it("numbers a Process's output in order, and reads what came after a sequence", async () => {
    const sessionId = randomUUID();
    const started = aProcess(sessionId);
    await repository.add(started);

    for (const text of ["one\n", "two\n", "three\n"]) await repository.addOutput(started, text);

    expect(await repository.outputAfter(started, 1)).toEqual([
      { sequence: 2, text: "two\n" },
      { sequence: 3, text: "three\n" },
    ]);
    expect(await repository.find(started)).toMatchObject({ lastSequence: 3 });
  });

  it("gives a page that read in the middle of a stream every chunk exactly once, applying only the events after its sequence", async () => {
    const sessionId = randomUUID();
    const started = aProcess(sessionId);
    await repository.add(started);
    const live: { sequence: number; text: string }[] = [];
    const keep = async (text: string) => {
      const chunk = await repository.addOutput(started, text);
      if (chunk) live.push(chunk);
    };

    await keep("a\n");
    // The page subscribes, holding what arrives, then reads while the stream goes on.
    const heldFrom = live.length;
    await keep("b\n");
    const read = await repository.outputAfter(started, 0);
    const readUpTo = read.at(-1)?.sequence ?? 0;
    await keep("c\n");
    const page = [...read, ...live.slice(heldFrom).filter(({ sequence }) => sequence > readUpTo)];

    expect(page.map(({ text }) => text)).toEqual(["a\n", "b\n", "c\n"]);
  });

  it("keeps the last 256 KB of a Process's output, counting how much earlier output it dropped", async () => {
    const sessionId = randomUUID();
    const started = aProcess(sessionId);
    await repository.add(started);
    const line = `${"x".repeat(1023)}\n`;

    for (let read = 0; read < 300; read += 1) await repository.addOutput(started, line);

    const kept = await repository.outputAfter(started, 0);
    expect(kept.reduce((bytes, { text }) => bytes + text.length, 0)).toBe(OUTPUT_KEPT_BYTES);
    expect(kept.at(-1)).toEqual({ sequence: 300, text: line });
    expect(await repository.find(started)).toMatchObject({
      earlierOutputNotKept: 300 * 1024 - OUTPUT_KEPT_BYTES,
      lastSequence: 300,
    });
  });

  it("keeps a Sub-agent's last 1,000 messages and tool calls, counting the earlier ones", async () => {
    const sessionId = randomUUID();
    const subAgent = aSubAgent(sessionId);
    await repository.add(subAgent);

    const drafts = Array.from({ length: MESSAGES_KEPT + 5 }, (_, index) => ({
      kind: "text" as const,
      text: `Message ${index + 1}`,
    }));
    await repository.addMessages(subAgent, drafts.slice(0, 600), AT);
    await repository.addMessages(subAgent, drafts.slice(600), AT);

    const kept = await repository.messagesAfter(subAgent, 0);
    expect(kept).toHaveLength(MESSAGES_KEPT);
    expect(kept[0]).toMatchObject({ sequence: 6, text: "Message 6" });
    expect(await repository.find(subAgent)).toMatchObject({
      earlierMessagesNotKept: 5,
      lastSequence: MESSAGES_KEPT + 5,
    });
  });

  it("keeps a session's latest 100 ended items and every Running one", async () => {
    const sessionId = randomUUID();
    const running = aProcess(sessionId, "running", AT);
    await repository.add(running);
    for (let index = 0; index < ENDED_ITEMS_KEPT + 2; index += 1) {
      const item = aProcess(sessionId, `ended-${index}`, AT);
      await repository.add(item);
      const ended = endItem(item, { state: "finished" }, new Date(AT.getTime() + index * 1000));
      if (ended) await repository.save(ended);
    }

    const kept = (await repository.ofSession(sessionId)).map(({ callId }) => callId);
    expect(kept).toHaveLength(ENDED_ITEMS_KEPT + 1);
    expect(kept).toContain("running");
    expect(kept).not.toContain("ended-0");
    expect(kept).not.toContain("ended-1");
    expect(kept).toContain("ended-2");
  });

  it("lists what still runs in any session, and removes a session's items with what they kept", async () => {
    const sessionId = randomUUID();
    const started = aProcess(sessionId);
    await repository.add(started);
    await repository.addOutput(started, "ready\n");

    expect((await repository.running()).map(({ sessionId: of }) => of)).toContain(sessionId);
    await repository.removeSession(sessionId);

    expect(await repository.ofSession(sessionId)).toEqual([]);
    expect(await repository.outputAfter(started, 0)).toEqual([]);
  });
});
