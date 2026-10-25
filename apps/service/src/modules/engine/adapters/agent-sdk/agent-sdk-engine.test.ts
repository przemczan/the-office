import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { describeAgentEngineContract } from "../../ports/agent-engine.contract.js";
import type { AgentEngine } from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";
import type { TurnEndedEvent } from "../../ports/session-events.js";
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

describe.runIf(MODE === "live" || MODE === "record")("AgentSdkEngine on a live session", () => {
  describeAgentEngineContract("AgentSdkEngine", {
    capabilities: new AgentSdkEngine().capabilities,
    model: MODEL,
    timeoutMs: 180_000,
    engineFor: () =>
      Promise.resolve(
        MODE === "record" ? new RecordingEngine(new AgentSdkEngine()) : new AgentSdkEngine(),
      ),
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
      const engine = new AgentSdkEngine();

      await firstTurn(engine, options(worktrees[0]));
      const second = await firstTurn(engine, options(worktrees[1]));

      expect(second.usage.cacheRead).toBeGreaterThan(0);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 180_000);
});

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
    skillsFolder: undefined,
    profile: { edit: false, run: { kind: "read-only-git" }, web: false },
    officeTools: [],
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
