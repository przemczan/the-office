import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  BusyWork,
  BusyWorkModule,
  OfficeUpdates,
  OfficeUpdatesModule,
  ScheduledExits,
} from "../../office-updates/index.js";
import { createOfficeCheckout, updateSystem } from "../../office-updates/index.fixtures.js";
import { PostgresSubAgentAndProcessRepository } from "../adapters/postgres/postgres-sub-agent-and-process-repository.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { aThread } from "../domain/thread.fixtures.js";
import type { Thread } from "../domain/thread.js";
import { NO_MASK } from "../ports/project-output-masks.js";
import { SubAgentAndProcessRepository } from "../ports/sub-agent-and-process-repository.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import type { SessionEvent } from "./session-log.js";
import { SubAgentsAndProcesses, type SessionFollowing } from "./sub-agents-and-processes.js";

const LABEL = `Angela's Sub-agents in an Initiative's Thread, "Planning the Initiative"`;

let folder: string;
let app: INestApplication;
let thread: Thread;
let sessionId: string;
let readyToUpdate: number;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "sub-agents-busy-"));
  const checkout = await createOfficeCheckout(join(folder, "office"));
  await checkout.pushNewer("Newer");
  const updateFolder = join(folder, "update");
  await mkdir(updateFolder);
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      BusyWorkModule,
      OfficeUpdatesModule.register({ checkout: checkout.path, updateFolder }),
    ],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: SubAgentAndProcessRepository, useClass: PostgresSubAgentAndProcessRepository },
      SubAgentsAndProcesses,
    ],
    overrides: [updateSystem()],
  }));
  readyToUpdate = 0;
  app.get(ScheduledExits).onReadyToExit(() => void (readyToUpdate += 1));
  sessionId = randomUUID();
  thread = aThread({ id: randomUUID(), home: { kind: "initiative", initiativeId: randomUUID() } });
  await app.get(ThreadRepository).add(thread);
});

afterEach(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

function follow(): SessionFollowing {
  return app.get(SubAgentsAndProcesses).follow({
    threadId: thread.id,
    home: thread.home,
    sessionId,
    folder: "/work",
    mask: NO_MASK,
    subAgentsLabel: LABEL,
  });
}

function subAgentStarted(callId: string, background: boolean): SessionEvent {
  return {
    kind: "sub-agent-started",
    callId,
    engineTaskId: undefined,
    withinToolCall: undefined,
    description: "Research the launcher",
    agentKind: "general-purpose",
    prompt: "Find how the launcher restarts the service.",
    background,
  };
}

function subAgentEnded(callId: string): SessionEvent {
  return {
    kind: "sub-agent-ended",
    callId,
    ending: { state: "finished" },
    reportedBack: "It restarts it with code 75.",
    toolCallCount: 3,
    totalTokens: 1_200,
  };
}

const aProcessStarted: SessionEvent = {
  kind: "process-started",
  callId: "bash-1",
  engineTaskId: "b1f9c2e07",
  withinToolCall: undefined,
  commandLine: "npm run dev",
  description: "Serve the app",
};

async function busyLabels(): Promise<readonly string[]> {
  return (await app.get(OfficeUpdates).view()).scheduled?.busy.map(({ label }) => label) ?? [];
}

describe("a session's background Sub-agents", () => {
  it("hold a scheduled update, listed by their Thread, until the last one ends", async () => {
    const following = follow();
    await following.take(subAgentStarted("agent-1", true));
    await following.take(subAgentStarted("agent-2", true));

    await app.get(OfficeUpdates).schedule();
    expect(await busyLabels()).toEqual([LABEL]);
    expect(following.backgroundSubAgentsRunning).toBe(true);

    await following.take(subAgentEnded("agent-1"));
    expect(await busyLabels()).toEqual([LABEL]);
    expect(readyToUpdate).toBe(0);

    const lastEnded = vi.fn<() => void>();
    following.whenBackgroundSubAgentsEnd(lastEnded);
    await following.take(subAgentEnded("agent-2"));

    await vi.waitFor(() => expect(readyToUpdate).toBe(1));
    expect(following.backgroundSubAgentsRunning).toBe(false);
    expect(lastEnded).toHaveBeenCalledOnce();
    await following.end();
  });

  it("stop holding it as the session ends", async () => {
    const following = follow();
    await following.take(subAgentStarted("agent-1", true));
    await app.get(OfficeUpdates).schedule();
    expect(await busyLabels()).toEqual([LABEL]);

    await following.end();

    await vi.waitFor(() => expect(readyToUpdate).toBe(1));
    expect(await app.get(SubAgentAndProcessRepository).ofSession(sessionId)).toMatchObject([
      { callId: "agent-1", ending: { state: "stopped", by: "session-end" } },
    ]);
  });

  it("are counted again by a resumed session, which reads them still running", async () => {
    const first = follow();
    await first.take(subAgentStarted("agent-1", true));
    // The engine's process went away without the session's end, as when it is resumed later.
    const busyWork = app.get(BusyWork);
    const resumed = follow();

    await vi.waitFor(() => expect(resumed.backgroundSubAgentsRunning).toBe(true));
    expect(busyWork.list().filter(({ label }) => label === LABEL)).toHaveLength(2);
    await resumed.take(subAgentEnded("agent-1"));
    expect(resumed.backgroundSubAgentsRunning).toBe(false);
    await first.end();
    await resumed.end();
  });

  it("are the only ones counted: a foreground Sub-agent and a background Process add nothing", async () => {
    const following = follow();
    await following.take(subAgentStarted("agent-1", false));
    await following.take(aProcessStarted);

    expect(following.backgroundSubAgentsRunning).toBe(false);
    expect(app.get(BusyWork).list()).toEqual([]);
    await following.end();
  });

  it("are counted from when the engine says a Sub-agent went to the background", async () => {
    const following = follow();
    await following.take(subAgentStarted("agent-1", false));

    await following.take({
      kind: "sub-agent-changed",
      callId: "agent-1",
      engineTaskId: "a1",
      background: true,
    });

    expect(app.get(BusyWork).list()).toEqual([{ kind: "sub-agents", label: LABEL }]);
    await following.end();
    expect(app.get(BusyWork).list()).toEqual([]);
  });
});

describe("a Sub-agent's context size", () => {
  it("is folded in from the engine's progress as a revision, and kept by an end that gives none", async () => {
    const following = follow();
    const items = app.get(SubAgentAndProcessRepository);
    await following.take(subAgentStarted("agent-1", true));

    await following.take({ kind: "sub-agent-progress", callId: "agent-1", totalTokens: 2_100 });
    expect(await items.find({ sessionId, callId: "agent-1" })).toMatchObject({
      totalTokens: 2_100,
      revision: 1,
    });

    await following.take({ kind: "sub-agent-progress", callId: "agent-1", totalTokens: 2_100 });
    await following.take({ kind: "sub-agent-progress", callId: "agent-1", totalTokens: 3_400 });
    expect(await items.find({ sessionId, callId: "agent-1" })).toMatchObject({
      totalTokens: 3_400,
      revision: 2,
    });

    await following.take({
      kind: "sub-agent-ended",
      callId: "agent-1",
      ending: { state: "stopped", by: "interrupt" },
      reportedBack: undefined,
      toolCallCount: undefined,
      totalTokens: undefined,
    });
    expect(await items.find({ sessionId, callId: "agent-1" })).toMatchObject({
      totalTokens: 3_400,
      ending: { state: "stopped", by: "interrupt" },
      revision: 3,
    });
    await following.end();
  });

  it("takes the end's size over the progress's, and no progress after the end", async () => {
    const following = follow();
    const items = app.get(SubAgentAndProcessRepository);
    await following.take(subAgentStarted("agent-1", false));
    await following.take({ kind: "sub-agent-progress", callId: "agent-1", totalTokens: 900 });

    await following.take(subAgentEnded("agent-1"));
    await following.take({ kind: "sub-agent-progress", callId: "agent-1", totalTokens: 5_000 });

    expect(await items.find({ sessionId, callId: "agent-1" })).toMatchObject({
      totalTokens: 1_200,
      revision: 2,
    });
    await following.end();
  });
});

describe("recovering after a restart", () => {
  it("returns the Threads whose background Sub-agents it stopped, never those with only a foreground one or a Process", async () => {
    const following = follow();
    await following.take(subAgentStarted("agent-1", true));
    const other = aThread({ id: randomUUID(), home: { kind: "chat", roleKey: "cto" } });
    await app.get(ThreadRepository).add(other);
    const elsewhere = app.get(SubAgentsAndProcesses).follow({
      threadId: other.id,
      home: other.home,
      sessionId: randomUUID(),
      folder: "/work",
      mask: NO_MASK,
      subAgentsLabel: "Ben's Sub-agents in a chat",
    });
    await elsewhere.take(subAgentStarted("agent-2", false));
    await elsewhere.take(aProcessStarted);
    // Test files share one database: stopping every Running one would stop those of others.
    const items = app.get(SubAgentAndProcessRepository);
    const running = items.running.bind(items);
    vi.spyOn(items, "running").mockImplementation(async () =>
      (await running()).filter(({ threadId }) => threadId === thread.id || threadId === other.id),
    );

    const cutShort = await app.get(SubAgentsAndProcesses).recover();

    expect(cutShort).toEqual([thread.id]);
    expect(await app.get(SubAgentAndProcessRepository).ofSession(sessionId)).toMatchObject([
      { callId: "agent-1", ending: { state: "stopped", by: "restart" } },
    ]);
  });
});
