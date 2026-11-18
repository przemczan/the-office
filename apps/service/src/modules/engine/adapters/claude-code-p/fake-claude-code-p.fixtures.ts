import { readFile } from "node:fs/promises";
import type { EngineCommand } from "../claude-code/engine-process.js";

/** When the stand-in's 5-hour window resets. */
export const FAKE_FIVE_HOUR_RESET = "2027-01-15T10:00:00.000Z";
/** When the stand-in's 7-day window resets. */
export const FAKE_SEVEN_DAY_RESET = "2027-01-20T10:00:00.000Z";

/** How the stand-in answers: `answers` a usage query, `silent` answers nothing and won't end by itself. */
export type FakeClaudeCodePMode = "answers" | "silent";

/**
 * A stand-in for the pinned binary in `-p` with stream-json, a Node script: in `answers` mode it
 * answers `get_usage` with an account's 5-hour window at 12% and 7-day window at 30%
 * (`FAKE_FIVE_HOUR_RESET`, `FAKE_SEVEN_DAY_RESET`), every other control request with an error, and
 * ends once its input closes; in `silent` mode it answers nothing and runs on after its input
 * closes, until it is ended. It appends to the file its first argument names, one JSON line each:
 * how it started (its process id and its arguments) and every line it received.
 */
const FAKE_CLAUDE_CODE_P = `
const fs = require("node:fs");
const [report, mode] = process.argv.slice(1);
const log = (entry) => fs.appendFileSync(report, JSON.stringify(entry) + "\\n");
log({ started: process.pid, argv: process.argv.slice(3) });
const out = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const m = JSON.parse(line);
  log({ received: m });
  if (mode === "silent" || m.type !== "control_request") return;
  const request_id = m.request_id;
  if (m.request.subtype !== "get_usage") {
    return out({ type: "control_response", response: { subtype: "error", request_id, error: "unknown" } });
  }
  out({ type: "control_response", response: { subtype: "success", request_id, response: {
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 12, resets_at: "${FAKE_FIVE_HOUR_RESET}" },
      seven_day: { utilization: 30, resets_at: "${FAKE_SEVEN_DAY_RESET}" },
      limits: [],
    },
  } } });
});
if (mode === "silent") setInterval(() => undefined, 1000);
else lines.on("close", () => process.exit(0));
`;

/** Runs `FAKE_CLAUDE_CODE_P` in `mode` with `args`, as the binary would run, reporting to `reportFile`. */
export function fakeClaudeCodeP(
  reportFile: string,
  mode: FakeClaudeCodePMode,
  args: readonly string[],
): EngineCommand {
  return {
    command: process.execPath,
    args: ["-e", FAKE_CLAUDE_CODE_P, reportFile, mode, ...args],
    env: { PATH: process.env["PATH"] ?? "" },
  };
}

/** What the stand-in reported, by process: its id, its arguments and the lines it received. */
export interface FakeClaudeCodePRun {
  readonly processId: number;
  readonly argv: readonly string[];
  readonly received: readonly unknown[];
}

export async function fakeClaudeCodePRuns(reportFile: string): Promise<FakeClaudeCodePRun[]> {
  const text = await readFile(reportFile, "utf8").catch(() => "");
  const runs: { processId: number; argv: string[]; received: unknown[] }[] = [];
  for (const line of text.split("\n").filter((one) => one !== "")) {
    const entry = JSON.parse(line) as { started?: number; argv?: string[]; received?: unknown };
    if (entry.started !== undefined) {
      runs.push({ processId: entry.started, argv: entry.argv ?? [], received: [] });
    } else if (entry.received !== undefined) {
      runs.at(-1)?.received.push(entry.received);
    }
  }
  return runs;
}
