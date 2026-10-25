import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { metrics, trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { Telemetry } from "../../../../platform/telemetry/telemetry.js";
import { EngineSessions } from "../../application/engine-sessions.js";
import { OfficeToolRegistry } from "../../application/office-tool-registry.js";
import { UsageWindowState } from "../../application/usage-window-state.js";
import { describeAgentEngineContract } from "../../ports/agent-engine.contract.js";
import type { AgentEngine } from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";
import type { SessionEvent, TurnEndedEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { RecordingEngine } from "../scripted/recording-engine.js";
import { AgentSdkEngine } from "./agent-sdk-engine.js";

/**
 * These tests run real sessions on the user's login, which cost quota, so they run only when asked:
 * OFFICE_ENGINE_TESTS=live runs them, and OFFICE_ENGINE_TESTS=record also writes each contract
 * scenario's recording for the scripted engine (apps/service/README.md).
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const MODEL = "claude-haiku-5-5";
const RECORDINGS = fileURLToPath(new URL("../scripted/recordings/", import.meta.url));
const run = promisify(execFile);

/** No session here works inside it; the Office rules keep sessions out of it. */
const OFFICE_DATA = new OfficeDataDirectory(join(tmpdir(), "office-engine-data"));
const liveEngine = () => new AgentSdkEngine(OFFICE_DATA);

describe.runIf(MODE === "live" || MODE === "record")("AgentSdkEngine on a live session", () => {
  describeAgentEngineContract("AgentSdkEngine", {
    capabilities: liveEngine().capabilities,
    model: MODEL,
    timeoutMs: 180_000,
    engineFor: () =>
      Promise.resolve(MODE === "record" ? new RecordingEngine(liveEngine()) : liveEngine()),
    afterScenario: async (scenario, engine) => {
      if (engine instanceof RecordingEngine) {
        await engine.save(join(RECORDINGS, `${scenario}.jsonl`));
      }
    },
  });

  it("shares the cached prefix between sessions in two worktrees of one repository", async () => {
    const folder = await mkdtemp(join(tmpdir(), "office-cache-"));
    try {
      const worktrees = await twoWorktrees(folder);
      const engine = liveEngine();

      await firstTurn(engine, options(worktrees[0]));
      const second = await firstTurn(engine, options(worktrees[1]));

      expect(second.usage.cacheRead).toBeGreaterThan(0);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 180_000);

  it("gives a session the Office tools its caller names from the registry", async () => {
    const folder = await mkdtemp(join(tmpdir(), "office-tools-"));
    try {
      const words: string[] = [];
      const registry = new OfficeToolRegistry();
      registry.register({
        name: "note",
        description: "Notes down one word for The Office.",
        input: z.object({ word: z.string() }),
        run: ({ word }) => {
          words.push(word);
          return Promise.resolve({ text: "Noted.", isError: false });
        },
      });
      const events = new EventBus();
      const sessions = new EngineSessions(
        liveEngine(),
        new Telemetry(trace.getTracer("test"), metrics.getMeter("test")),
        events,
        new UsageWindowState(events),
        registry,
      );

      const session = await sessions.start({
        id: randomUUID(),
        settings: { ...options(folder), officeTools: ["note"] },
        brief: message(
          'Call the note tool once with the word "tangerine", then reply with the single word: done',
        ),
      });
      await turnEnded(session);
      await session.end();

      expect(words).toEqual(["tangerine"]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 180_000);

  it("starts a session that lists exactly its skills, and refuses one that wouldn't", async () => {
    const folder = await mkdtemp(join(tmpdir(), "office-start-check-"));
    try {
      const skillsFolder = await aSessionPlugin(join(folder, "skills"), ["alpha"]);
      const skills = { folder: skillsFolder, names: ["office:alpha"], overrides: {} };
      const engine = liveEngine();

      await expect(
        engine.start({
          id: randomUUID(),
          options: {
            ...options(folder),
            skills: { ...skills, expected: ["office:alpha", "office:beta"] },
          },
          brief: message("Reply with the single word: ok"),
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          name: "SessionSkillsDiffer",
          problems: ["It doesn't list office:beta."],
        }),
      );
      const session = await engine.start({
        id: randomUUID(),
        options: { ...options(folder), skills: { ...skills, expected: ["office:alpha"] } },
        brief: message("Reply with the single word: ok"),
      });
      await turnEnded(session);
      await session.end();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 180_000);

  it("lets a session read the output of its own background command", async () => {
    const folder = await mkdtemp(join(tmpdir(), "office-background-"));
    try {
      const session = await liveEngine().start({
        id: randomUUID(),
        options: {
          ...options(folder),
          profile: { edit: false, run: { kind: "anything" }, web: false },
        },
        brief: message(
          "Use the Bash tool with run_in_background set to true to run: echo background-42 && sleep 30. " +
            "Do not wait for it to finish: read its output file now with the Read tool, not with a command, " +
            "and reply with what it printed so far.",
        ),
      });
      const reported: SessionEvent[] = [];
      for await (const event of session.events) {
        reported.push(event);
        if (event.kind === "turn-ended") break;
      }
      await session.end();

      const reads = reported.filter((event) => event.kind === "tool-call" && event.tool === "Read");
      expect(reads).not.toEqual([]);
      expect(reported.filter((event) => event.kind === "tool-refused")).toEqual([]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 180_000);

  it("ends what a session started when the session ends", async () => {
    const folder = await mkdtemp(join(tmpdir(), "office-leftovers-"));
    try {
      const pidFile = join(folder, "keep-alive.pid");
      // Stands for a dev server or a watcher: it runs until something ends it.
      await writeFile(
        join(folder, "keep-alive.mjs"),
        [
          'import { writeFileSync } from "node:fs";',
          'writeFileSync("keep-alive.pid", String(process.pid));',
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );
      const session = await liveEngine().start({
        id: randomUUID(),
        options: {
          ...options(folder),
          profile: { edit: false, run: { kind: "anything" }, web: false },
        },
        brief: message(
          "Use the Bash tool with run_in_background set to true to run: node keep-alive.mjs. " +
            "Do not wait for it or check on it; reply with the single word: started",
        ),
      });
      await turnEnded(session);
      const keptAlive = await vi.waitFor(async () => Number(await readFile(pidFile, "utf8")), {
        timeout: 20_000,
        interval: 500,
      });
      expect(isRunning(keptAlive)).toBe(true);

      await session.end();

      await vi.waitFor(() => expect(isRunning(keptAlive)).toBe(false), { timeout: 10_000 });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 180_000);
});

/** A session's plugin folder as the Skills module writes one, with a skill of each name. */
async function aSessionPlugin(folder: string, names: readonly string[]): Promise<string> {
  await mkdir(join(folder, ".claude-plugin"), { recursive: true });
  await writeFile(join(folder, ".claude-plugin", "plugin.json"), '{"name":"office"}\n');
  for (const name of names) {
    await mkdir(join(folder, "skills", name), { recursive: true });
    await writeFile(
      join(folder, "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nReply with the word ${name}.\n`,
    );
  }
  return folder;
}

function message(text: string) {
  return { id: randomUUID(), text };
}

function isRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

/** A repository in `folder` with two worktrees beside it. */
async function twoWorktrees(folder: string): Promise<[string, string]> {
  const repository = join(folder, "repository");
  await run("git", ["init", "--initial-branch=main", repository]);
  const git = (...args: string[]) => run("git", args, { cwd: repository });
  await writeFile(join(repository, "README.md"), "# Cache check\n");
  await git("add", ".");
  await git("-c", "user.name=Office", "-c", "user.email=office@localhost", "commit", "-m", "start");
  const worktrees: [string, string] = [join(folder, "one"), join(folder, "two")];
  for (const worktree of worktrees) await git("worktree", "add", "--detach", worktree);
  return worktrees;
}

function options(folder: string): SessionOptions {
  return {
    folder,
    environment: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    model: MODEL,
    effort: "low",
    skills: undefined,
    profile: { edit: false, run: { kind: "read-only-git" }, web: false },
    officeTools: [],
    instructions: "",
    outputSchema: undefined,
  };
}

async function firstTurn(
  engine: AgentEngine,
  sessionOptions: SessionOptions,
): Promise<TurnEndedEvent> {
  const session = await engine.start({
    id: randomUUID(),
    options: sessionOptions,
    brief: { id: randomUUID(), text: "Reply with the single word: ok" },
  });
  try {
    return await turnEnded(session);
  } finally {
    await session.end();
  }
}

async function turnEnded(session: EngineSession): Promise<TurnEndedEvent> {
  for await (const event of session.events) {
    if (event.kind === "turn-ended") return event;
  }
  throw new Error(`Session ${session.id} ended before its turn did.`);
}
