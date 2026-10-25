import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentEngine, CapabilityMissing, type EngineCapabilities } from "./agent-engine.js";
import type { EngineSession, UserMessage } from "./engine-session.js";
import type { OfficeTool, OfficeToolCall } from "./office-tool.js";
import type { SessionEvent, ToolCallEvent, TurnEndedEvent } from "./session-events.js";
import type { SessionOptions } from "./session-options.js";

/**
 * What every adapter of `AgentEngine` does, as tests each adapter runs against itself. Each
 * scenario has a name, which a scripted engine replays the recording of. A scenario asserts only
 * the shape of what happened, never the model's words, so it holds for a live engine too.
 */
export const CONTRACT_SCENARIOS = [
  "reply",
  "office-tool",
  "barge-in",
  "later",
  "interrupt",
  "resume",
  "output-schema",
  "usage-windows",
] as const;

export type ContractScenario = (typeof CONTRACT_SCENARIOS)[number];

export interface EngineUnderContract {
  /** What the adapter declares; scenarios for a missing capability check its refusal instead. */
  readonly capabilities: EngineCapabilities;
  /** The model sessions run on: the cheapest that follows the briefs. */
  readonly model: string;
  /** How long one scenario may take. */
  readonly timeoutMs: number;
  /** The engine for one scenario; called once per scenario, before its sessions start. */
  engineFor(scenario: ContractScenario): Promise<AgentEngine>;
  /** Called once a scenario's sessions have ended, as a recording engine saves them. */
  afterScenario?(scenario: ContractScenario, engine: AgentEngine): Promise<void>;
}

type ScenarioRun = (engine: AgentEngine, options: SessionOptions) => Promise<void>;

export function describeAgentEngineContract(adapter: string, under: EngineUnderContract): void {
  const can = under.capabilities;

  describe(`${adapter} keeps the AgentEngine contract`, () => {
    let folder: string;

    beforeEach(async () => {
      folder = await mkdtemp(join(tmpdir(), "office-engine-"));
    });

    afterEach(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    /** Runs one scenario against a fresh engine, then lets the adapter's test keep what it ran. */
    const scenario =
      (name: ContractScenario, run: ScenarioRun): (() => Promise<void>) =>
      async () => {
        const engine = await under.engineFor(name);
        expect(engine.capabilities).toEqual(under.capabilities);
        await run(engine, defaultOptions(folder, under.model));
        await under.afterScenario?.(name, engine);
      };

    it(
      "starts a session on its brief, reports a turn that took it with its tokens, and ends",
      scenario("reply", async (engine, options) => {
        const brief = message("Reply with the single word: ready");
        const session = await engine.start({ id: randomUUID(), options, brief });
        const log = new EventLog(session);

        const turn = await log.nextTurn();
        expect(turn.outcome).toBe("completed");
        expect(turn.consumedMessageIds).toEqual([brief.id]);
        expect(log.events.some((event) => event.kind === "text")).toBe(true);
        expect(turn.usage.output).toBeGreaterThan(0);
        expect(turn.usage.input + turn.usage.cacheRead + turn.usage.cacheCreation).toBeGreaterThan(
          0,
        );
        expect(turn.sessionCostUsd).toBeGreaterThanOrEqual(0);
        await session.end();
        await log.finished;
      }),
      under.timeoutMs,
    );

    it.runIf(can.officeTools)(
      "runs an Office tool the Agent calls, and the Agent reads what it answers",
      scenario("office-tool", async (engine, options) => {
        const notes = noteTool();
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [notes.tool] },
          brief: message(
            `Call the ${notes.tool.name} tool once with the word "tangerine", then reply with the single word: done`,
          ),
        });
        const log = new EventLog(session);

        expect((await log.nextTurn()).outcome).toBe("completed");
        const call = log.officeToolCall(notes.tool.name);
        expect(call.input).toEqual({ word: "tangerine" });
        expect(notes.calls).toEqual([{ input: { word: "tangerine" }, sessionId: session.id }]);
        expect(log.resultOf(call)).toMatchObject({ text: NOTED, isError: false });
        await session.end();
      }),
      under.timeoutMs,
    );

    it.skipIf(can.officeTools)(
      "refuses a session with Office tools without the officeTools capability",
      scenario("office-tool", async (engine, options) => {
        const start = engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [noteTool().tool] },
          brief: message("Reply with the single word: ready"),
        });
        await expect(start).rejects.toEqual(new CapabilityMissing("officeTools"));
      }),
      under.timeoutMs,
    );

    it.runIf(can.bargeIn && can.officeTools)(
      "lands a message sent with priority next in the running turn, between tool calls",
      scenario("barge-in", async (engine, options) => {
        const hold = holdTool();
        const brief = message(holdBrief(hold.tool));
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [hold.tool] },
          brief,
        });
        const log = new EventLog(session);

        await hold.called;
        const bargeIn = message("Also reply with the single word: extra");
        session.send(bargeIn, "next");
        hold.release();

        expect((await log.nextTurn()).consumedMessageIds).toEqual([brief.id, bargeIn.id]);
        await session.end();
      }),
      under.timeoutMs,
    );

    it.runIf(can.officeTools)(
      "holds a message sent with priority later until the turn ends, then starts a turn on it",
      scenario("later", async (engine, options) => {
        const hold = holdTool();
        const brief = message(holdBrief(hold.tool));
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [hold.tool] },
          brief,
        });
        const log = new EventLog(session);

        await hold.called;
        const later = message("Reply with the single word: later");
        session.send(later, "later");
        hold.release();

        expect((await log.nextTurn()).consumedMessageIds).toEqual([brief.id]);
        const next = await log.nextTurn();
        expect(next.consumedMessageIds).toEqual([later.id]);
        expect(next.outcome).toBe("completed");
        await session.end();
      }),
      under.timeoutMs,
    );

    it.runIf(can.interrupt && can.officeTools)(
      "stops the running turn on interrupt, and the session takes the next message",
      scenario("interrupt", async (engine, options) => {
        const hold = holdTool();
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, officeTools: [hold.tool] },
          brief: message(holdBrief(hold.tool)),
        });
        const log = new EventLog(session);

        await hold.called;
        await session.interrupt();
        expect((await log.nextTurn()).outcome).toBe("interrupted");
        hold.release();

        const after = message("Reply with the single word: back");
        session.send(after, "next");
        const next = await log.nextTurn();
        expect(next.outcome).toBe("completed");
        expect(next.consumedMessageIds).toEqual([after.id]);
        await session.end();
      }),
      under.timeoutMs,
    );

    it.skipIf(can.interrupt)(
      "refuses to interrupt without the interrupt capability",
      scenario("reply", async (engine, options) => {
        await replyingSession(engine, options, async (session) => {
          await expect(session.interrupt()).rejects.toEqual(new CapabilityMissing("interrupt"));
        });
      }),
      under.timeoutMs,
    );

    it.runIf(can.resume && can.officeTools)(
      "resumes an ended session by its id, with its conversation",
      scenario("resume", async (engine, options) => {
        const notes = noteTool();
        const withNotes = { ...options, officeTools: [notes.tool] };
        const id = randomUUID();
        const first = await engine.start({
          id,
          options: withNotes,
          brief: message(
            'Remember the word "tangerine" for later. Do not call any tool now; reply with the single word: ok',
          ),
        });
        expect((await new EventLog(first).nextTurn()).outcome).toBe("completed");
        expect(notes.calls).toEqual([]);
        await first.end();

        const resumed = await engine.resume(id, withNotes);
        expect(resumed.id).toBe(id);
        const log = new EventLog(resumed);
        resumed.send(
          message(
            `Call the ${notes.tool.name} tool once with the word you were asked to remember, then reply with the single word: done`,
          ),
          "next",
        );
        expect((await log.nextTurn()).outcome).toBe("completed");
        expect(notes.calls).toEqual([{ input: { word: "tangerine" }, sessionId: id }]);
        await resumed.end();
      }),
      under.timeoutMs,
    );

    it.skipIf(can.resume)(
      "refuses to resume without the resume capability",
      scenario("resume", async (engine, options) => {
        await expect(engine.resume(randomUUID(), options)).rejects.toEqual(
          new CapabilityMissing("resume"),
        );
      }),
      under.timeoutMs,
    );

    it.runIf(can.outputSchema)(
      "ends a turn in output that matches the session's output schema",
      scenario("output-schema", async (engine, options) => {
        const session = await engine.start({
          id: randomUUID(),
          options: { ...options, outputSchema: WORD_SCHEMA },
          brief: message("Answer with the word ready."),
        });
        const log = new EventLog(session);

        const turn = await log.nextTurn();
        expect(turn.outcome).toBe("completed");
        expect(turn.output).toEqual({ word: expect.any(String) });
        await session.end();
      }),
      under.timeoutMs,
    );

    it.skipIf(can.outputSchema)(
      "refuses a session with an output schema without the outputSchema capability",
      scenario("output-schema", async (engine, options) => {
        const start = engine.start({
          id: randomUUID(),
          options: { ...options, outputSchema: WORD_SCHEMA },
          brief: message("Answer with the word ready."),
        });
        await expect(start).rejects.toEqual(new CapabilityMissing("outputSchema"));
      }),
      under.timeoutMs,
    );

    it.runIf(can.usageWindows)(
      "reads the account's usage windows",
      scenario("usage-windows", async (engine, options) => {
        await replyingSession(engine, options, async (session) => {
          const windows = await session.readUsageWindows();
          expect(windows).toBeDefined();
          for (const window of [windows?.fiveHour, windows?.sevenDay]) {
            expect(window?.percentUsed).toBeGreaterThanOrEqual(0);
            expect(window?.percentUsed).toBeLessThanOrEqual(100);
          }
        });
      }),
      under.timeoutMs,
    );

    it.skipIf(can.usageWindows)(
      "refuses to read the usage windows without the usageWindows capability",
      scenario("reply", async (engine, options) => {
        await replyingSession(engine, options, async (session) => {
          await expect(session.readUsageWindows()).rejects.toEqual(
            new CapabilityMissing("usageWindows"),
          );
        });
      }),
      under.timeoutMs,
    );
  });
}

const READ_ONLY = { edit: false, run: { kind: "read-only-git" }, web: false } as const;

const NOTED = "Noted.";

const WORD_SCHEMA = {
  type: "object",
  properties: { word: { type: "string" } },
  required: ["word"],
  additionalProperties: false,
};

function defaultOptions(folder: string, model: string): SessionOptions {
  return {
    folder,
    environment: inheritedEnvironment(),
    model,
    effort: "low",
    skillsFolder: undefined,
    profile: READ_ONLY,
    officeTools: [],
    outputSchema: undefined,
  };
}

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function message(text: string): UserMessage {
  return { id: randomUUID(), text };
}

/** A session through one turn on a short reply, with `afterTurn` done before it ends. */
async function replyingSession(
  engine: AgentEngine,
  options: SessionOptions,
  afterTurn: (session: EngineSession) => Promise<void>,
): Promise<void> {
  const session = await engine.start({
    id: randomUUID(),
    options,
    brief: message("Reply with the single word: ok"),
  });
  await new EventLog(session).nextTurn();
  await afterTurn(session);
  await session.end();
}

/** An Office tool that keeps what it is called with. */
function noteTool() {
  const calls: ({ input: unknown } & OfficeToolCall)[] = [];
  const tool: OfficeTool = {
    name: "note",
    description: "Notes down one word for The Office.",
    input: z.object({ word: z.string() }),
    run: (input, call) => {
      calls.push({ input, ...call });
      return Promise.resolve({ text: NOTED, isError: false });
    },
  };
  return { tool, calls };
}

/** An Office tool that runs until the test releases it, so a turn is surely running meanwhile. */
function holdTool() {
  const released = signal();
  const called = signal();
  const tool: OfficeTool = {
    name: "hold",
    description: "Waits until The Office lets the work go on.",
    input: z.object({}),
    run: async () => {
      called.resolve();
      await released.promise;
      return { text: "Go on.", isError: false };
    },
  };
  return { tool, called: called.promise, release: () => released.resolve() };
}

/** A promise and what settles it. */
function signal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
}

function holdBrief(tool: OfficeTool): string {
  return `Call the ${tool.name} tool once, then reply with the single word: done`;
}

/** Reads a session's events as they come, for a test to wait on. */
class EventLog {
  readonly events: SessionEvent[] = [];
  readonly finished: Promise<void>;
  private turnsTaken = 0;
  private readonly waiters = new Set<() => void>();
  private failure: unknown;
  private ended = false;

  constructor(session: EngineSession) {
    this.finished = this.read(session);
    this.finished.catch(() => undefined);
  }

  /** The next turn's end not returned before. */
  nextTurn(): Promise<TurnEndedEvent> {
    const turn = this.turnsTaken++;
    return this.waitFor(() => this.turns()[turn]);
  }

  officeToolCall(tool: string): ToolCallEvent {
    const call = this.events.find(
      (event): event is ToolCallEvent =>
        event.kind === "tool-call" && event.officeTool && event.tool === tool,
    );
    if (call === undefined) throw new Error(`No call of the Office tool ${tool} was reported.`);
    return call;
  }

  resultOf(call: ToolCallEvent): SessionEvent | undefined {
    return this.events.find(
      (event) => event.kind === "tool-result" && event.callId === call.callId,
    );
  }

  private turns(): TurnEndedEvent[] {
    return this.events.filter((event): event is TurnEndedEvent => event.kind === "turn-ended");
  }

  private waitFor<T>(found: () => T | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = (): void => {
        const value = found();
        if (value !== undefined) {
          this.waiters.delete(check);
          resolve(value);
        } else if (this.ended) {
          this.waiters.delete(check);
          reject(
            this.failure ?? new Error("The session's events finished before what was awaited."),
          );
        }
      };
      this.waiters.add(check);
      check();
    });
  }

  private async read(session: EngineSession): Promise<void> {
    try {
      for await (const event of session.events) {
        this.events.push(event);
        this.notify();
      }
    } catch (error) {
      this.failure = error;
      throw error;
    } finally {
      this.ended = true;
      this.notify();
    }
  }

  private notify(): void {
    // A check removes itself from the set it is called from; Set iteration allows that.
    for (const check of this.waiters) check();
  }
}
