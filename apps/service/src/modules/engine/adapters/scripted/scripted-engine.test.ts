import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeAgentEngineContract } from "../../ports/agent-engine.contract.js";
import type { EngineCapabilities } from "../../ports/agent-engine.js";
import type { SessionEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { RecordingEngine } from "./recording-engine.js";
import { ScriptedEngine, ScriptMismatch } from "./scripted-engine.js";
import { PLACEHOLDERS, readRecording, type SessionScript } from "./session-script.js";

const RECORDINGS = fileURLToPath(new URL("./recordings/", import.meta.url));

const NO_CAPABILITY: EngineCapabilities = {
  bargeIn: false,
  interrupt: false,
  resume: false,
  usageWindows: false,
  officeTools: false,
  outputSchema: false,
};

describeAgentEngineContract("ScriptedEngine replaying the recordings", {
  capabilities: new ScriptedEngine([]).capabilities,
  model: "scripted",
  timeoutMs: 5000,
  engineFor: async (scenario) =>
    new ScriptedEngine(await readRecording(join(RECORDINGS, `${scenario}.jsonl`))),
});

describeAgentEngineContract("ScriptedEngine without capabilities", {
  capabilities: NO_CAPABILITY,
  model: "scripted",
  timeoutMs: 5000,
  engineFor: async (scenario) =>
    new ScriptedEngine(await readRecording(join(RECORDINGS, `${scenario}.jsonl`)), NO_CAPABILITY),
});

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-scripted-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

function options(): SessionOptions {
  return {
    folder,
    environment: {},
    model: "scripted",
    effort: "low",
    skillsFolder: undefined,
    profile: { edit: true, run: { kind: "anything" }, web: false },
    officeTools: [],
    outputSchema: undefined,
  };
}

const TURN_ENDED: SessionEvent = {
  kind: "turn-ended",
  outcome: "completed",
  consumedMessageIds: ["brief"],
  usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
  sessionCostUsd: 0,
  output: undefined,
  errors: [],
};

/** Reads `file` in the working folder, then reports reading it. */
const READS_A_FILE: SessionScript = [
  { step: "start", brief: { id: "brief", text: "Read the plan." } },
  {
    step: "event",
    event: {
      kind: "tool-call",
      callId: "call-1",
      tool: "Read",
      officeTool: false,
      input: { file_path: `${PLACEHOLDERS.folder}/plan.md`, home: `${PLACEHOLDERS.home}/.ssh` },
      withinToolCall: undefined,
    },
  },
  { step: "event", event: TURN_ENDED },
  { step: "end" },
];

async function readAll(events: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const read: SessionEvent[] = [];
  for await (const event of events) read.push(event);
  return read;
}

describe("ScriptedEngine", () => {
  it("names the session's own folder and home where the script names them", async () => {
    const engine = new ScriptedEngine([READS_A_FILE]);
    const session = await engine.start({
      id: randomUUID(),
      options: options(),
      brief: { id: randomUUID(), text: "Read the plan." },
    });
    const reading = readAll(session.events);
    await session.end();

    expect((await reading)[0]).toMatchObject({
      input: { file_path: `${folder}/plan.md`, home: `${homedir()}/.ssh` },
    });
  });

  it("names the caller's message ids in the turns that took them, and keeps what the caller did", async () => {
    const engine = new ScriptedEngine([READS_A_FILE]);
    const brief = { id: randomUUID(), text: "Read the plan, please." };
    const session = await engine.start({ id: randomUUID(), options: options(), brief });
    const reading = readAll(session.events);
    await session.end();

    expect((await reading).at(-1)).toMatchObject({ consumedMessageIds: [brief.id] });
    expect(engine.sessions[0]?.received).toEqual([{ step: "start", brief }, { step: "end" }]);
  });

  it("fails the session when the caller does something other than the script's next step", async () => {
    const engine = new ScriptedEngine([READS_A_FILE]);
    const session = await engine.start({
      id: randomUUID(),
      options: options(),
      brief: { id: randomUUID(), text: "Read the plan." },
    });
    const reading = readAll(session.events);

    await expect(session.interrupt()).rejects.toThrow(
      "the script has its caller end next, but the caller asked to interrupt.",
    );
    await expect(reading).rejects.toBeInstanceOf(ScriptMismatch);
  });

  it("refuses a session no script is left for, and a request once the script has ended", async () => {
    const engine = new ScriptedEngine([READS_A_FILE]);
    const session = await engine.start({
      id: randomUUID(),
      options: options(),
      brief: { id: randomUUID(), text: "Read the plan." },
    });
    await session.end();

    await expect(session.interrupt()).rejects.toBeInstanceOf(ScriptMismatch);
    await expect(
      engine.start({
        id: randomUUID(),
        options: options(),
        brief: { id: randomUUID(), text: "Again." },
      }),
    ).rejects.toThrow("No script is left");
  });
});

describe("the Test Project check's recording", () => {
  it("replays a session refused a git commit and an ~/.ssh read by the Office rules", async () => {
    const engine = new ScriptedEngine(await readRecording(join(RECORDINGS, "test-project.jsonl")));
    const session = await engine.start({
      id: randomUUID(),
      options: {
        ...options(),
        profile: { edit: false, run: { kind: "read-only-git" }, web: false },
      },
      brief: { id: randomUUID(), text: "Read, commit, read a secret." },
    });
    const reading = readAll(session.events);
    await session.end();

    const refusals = (await reading).filter((event) => event.kind === "tool-refused");
    expect(refusals.map(({ tool, refusedBy }) => [tool, refusedBy])).toEqual([
      ["Bash", "office-rules"],
      ["Read", "office-rules"],
    ]);
  });
});

describe("RecordingEngine", () => {
  it("records what a session's caller did and what it reported, for the scripted engine to replay", async () => {
    const recording = new RecordingEngine(new ScriptedEngine([READS_A_FILE]));
    const brief = { id: "brief", text: "Read the plan." };
    const session = await recording.start({ id: randomUUID(), options: options(), brief });
    for await (const event of session.events) {
      if (event.kind === "turn-ended") break;
    }
    await session.end();
    const file = join(folder, "recording.jsonl");

    await recording.save(file);

    expect(await readRecording(file)).toEqual([READS_A_FILE]);
    const written = await readFile(file, "utf8");
    expect(written).not.toContain(folder);
    expect(written).not.toContain(homedir());
  });
});
