import { deleteSession, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { Check, Observation, Platform } from "./check.ts";
import type { Expectations } from "./expectations.ts";
import { diffJson, type JsonDifference } from "./json.ts";
import { ProbeSession, type HookCall, type TokenUsage } from "./probe-session.ts";
import { Sandbox } from "./sandbox.ts";
import { transcriptFolder } from "./transcripts.ts";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type CheckStatus = "matches" | "differs" | "unrecorded" | "failed";

export interface SessionTranscript {
  readonly sessionId: string;
  readonly messages: readonly SDKMessage[];
  readonly hookCalls: readonly HookCall[];
  readonly stderr: string;
}

export interface CheckOutcome {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly observed?: Observation;
  readonly expected?: Observation;
  readonly differences: readonly JsonDifference[];
  readonly error?: string;
  readonly tokens: TokenUsage;
  readonly durationMs: number;
  readonly sessions: readonly SessionTranscript[];
}

export async function runCheck(
  check: Check,
  expectations: Expectations,
  platform: Platform,
): Promise<CheckOutcome> {
  const startedAt = Date.now();
  // A referenced timer, unlike AbortSignal.timeout(), keeps the process alive until a stuck check is aborted.
  const timeoutMs = check.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error(`Timed out after ${timeoutMs} ms`)),
    timeoutMs,
  );
  const signal = timeout.signal;
  const sandbox = await Sandbox.create();
  const sessions: ProbeSession[] = [];
  const expected = expectations[check.id]?.[platform];
  try {
    const observed = await untilAborted(
      check.run({
        sandbox,
        signal,
        startSession: async (spec) => {
          const session = await ProbeSession.start(sandbox, spec, signal);
          sessions.push(session);
          return session;
        },
      }),
      signal,
    );
    const differences = diffJson(expected, observed);
    const status =
      expected === undefined ? "unrecorded" : differences.length === 0 ? "matches" : "differs";
    return outcome({ status, observed, differences });
  } catch (error) {
    return outcome({
      status: "failed",
      differences: [],
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  } finally {
    clearTimeout(timer);
    await Promise.allSettled(sessions.map((session) => session.close()));
    await Promise.allSettled(
      sessions.map((session) => deleteSession(session.sessionId, { dir: session.repository })),
    );
    await Promise.allSettled(
      [...new Set([...sessions.map((session) => session.repository), ...sandbox.repositories])].map(
        removeTranscriptFolder,
      ),
    );
    await sandbox.dispose();
  }

  function outcome(
    result: Pick<CheckOutcome, "status" | "observed" | "differences" | "error">,
  ): CheckOutcome {
    return {
      id: check.id,
      title: check.title,
      ...result,
      ...(expected === undefined ? {} : { expected }),
      tokens: sumTokens(sessions.map((session) => session.tokens())),
      durationMs: Date.now() - startedAt,
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        messages: session.messages,
        hookCalls: session.hookCalls,
        stderr: session.stderr,
      })),
    };
  }
}

/**
 * The engine keeps transcripts per working directory, with an auto-memory folder inside;
 * `rmdir` removes each only when empty, so nothing a check did not leave behind is touched.
 */
async function removeTranscriptFolder(repository: string): Promise<void> {
  const folder = transcriptFolder(repository);
  await rmdir(join(folder, "memory")).catch(() => undefined);
  await rmdir(folder);
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);
}

export function sumTokens(usages: readonly TokenUsage[]): TokenUsage {
  return usages.reduce(
    (total, usage) => ({
      input: total.input + usage.input,
      output: total.output + usage.output,
      cacheRead: total.cacheRead + usage.cacheRead,
      cacheCreation: total.cacheCreation + usage.cacheCreation,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  );
}
