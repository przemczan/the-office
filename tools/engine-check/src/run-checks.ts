import { deleteSession, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckSkipped, type Check, type Observation, type Platform } from "./check.ts";
import { ClaudeCodePSession } from "./claude-code-p/claude-code-p-session.ts";
import {
  CodexSession,
  type ApprovalCall,
  type CodexMessage,
  type CodexSessionSpec,
} from "./codex/codex-session.ts";
import {
  CopilotSession,
  type CopilotHookCall,
  type CopilotPermissionCall,
} from "./copilot-cli/copilot-session.ts";
import { COPILOT_TOKEN_VARIABLE } from "./copilot-cli/options.ts";
import type { CopilotSessionSpec } from "./copilot-cli/session-options.ts";
import type { SessionEvent } from "@microsoft/copilot-sdk";
import type { Expectations } from "./expectations.ts";
import { diffJson, type JsonDifference } from "./json.ts";
import { ProbeSession } from "./probe-session.ts";
import type { HookCall, RecordedSession, TokenUsage } from "./recorded-session.ts";
import { Sandbox } from "./sandbox.ts";
import { transcriptFolder } from "./transcripts.ts";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type CheckStatus = "matches" | "differs" | "unrecorded" | "skipped" | "failed";

export interface SessionTranscript {
  readonly sessionId: string;
  readonly messages: readonly SDKMessage[];
  readonly hookCalls: readonly HookCall[];
  readonly stderr: string;
}

export interface CodexSessionTranscript {
  readonly threadIds: readonly string[];
  readonly messages: readonly CodexMessage[];
  readonly approvalCalls: readonly ApprovalCall[];
  readonly stderr: string;
}

export interface CopilotSessionTranscript {
  readonly sessionId: string | undefined;
  readonly events: readonly SessionEvent[];
  readonly hookCalls: readonly CopilotHookCall[];
  readonly permissionCalls: readonly CopilotPermissionCall[];
}

export interface RunOptions {
  /** The signed-in Codex folder the `codex.*` checks run with as `CODEX_HOME`; they are skipped without one. */
  readonly codexHome?: string;
  /** A second signed-in Claude Code config folder, for the checks that carry a session to another account. */
  readonly secondClaudeConfig?: string;
  /** The Copilot token the `copilot.*` checks sign in with; they are skipped without one. */
  readonly copilotToken?: string;
}

export interface CheckOutcome {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly observed?: Observation;
  readonly expected?: Observation;
  readonly differences: readonly JsonDifference[];
  readonly error?: string;
  /** Why a skipped check observed nothing. */
  readonly reason?: string;
  readonly tokens: TokenUsage;
  readonly durationMs: number;
  readonly sessions: readonly SessionTranscript[];
  readonly codexSessions: readonly CodexSessionTranscript[];
  readonly copilotSessions: readonly CopilotSessionTranscript[];
}

export async function runCheck(
  check: Check,
  expectations: Expectations,
  platform: Platform,
  options: RunOptions = {},
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
  const sessions: RecordedSession[] = [];
  const codexSessions: CodexSession[] = [];
  const copilotSessions: CopilotSession[] = [];
  const copilotHome = join(sandbox.root, "copilot-home");
  const expected = expectations[check.id]?.[platform];
  try {
    const observed = await untilAborted(
      check.run({
        sandbox,
        signal,
        secondClaudeConfig: options.secondClaudeConfig,
        startSession: async (spec) => {
          const session = await ProbeSession.start(sandbox, spec, signal);
          sessions.push(session);
          return session;
        },
        startClaudeCodePSession: async (spec) => {
          const session = await ClaudeCodePSession.start(sandbox, spec, signal);
          sessions.push(session);
          return session;
        },
        startCodexSession: async (spec) => {
          const session = await startCodexSession(options.codexHome, spec, signal);
          codexSessions.push(session);
          return session;
        },
        copilotHome,
        startCopilotSession: async (spec) => {
          const session = await startCopilotSession(
            copilotHome,
            options.copilotToken,
            spec,
            signal,
          );
          copilotSessions.push(session);
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
    if (error instanceof CheckSkipped) {
      return outcome({ status: "skipped", differences: [], reason: error.message });
    }
    return outcome({
      status: "failed",
      differences: [],
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  } finally {
    clearTimeout(timer);
    await Promise.allSettled(sessions.map((session) => session.close()));
    await Promise.allSettled(codexSessions.map((session) => session.close()));
    await Promise.allSettled(copilotSessions.map((session) => session.close()));
    if (options.codexHome !== undefined) {
      await deleteCodexThreads(options.codexHome, codexSessions).catch(() => undefined);
    }
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
    result: Pick<CheckOutcome, "status" | "observed" | "differences" | "error" | "reason">,
  ): CheckOutcome {
    return {
      id: check.id,
      title: check.title,
      ...result,
      ...(expected === undefined ? {} : { expected }),
      tokens: sumTokens(
        [...sessions, ...codexSessions, ...copilotSessions].map((session) => session.tokens()),
      ),
      durationMs: Date.now() - startedAt,
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        messages: session.messages,
        hookCalls: session.hookCalls,
        stderr: session.stderr,
      })),
      codexSessions: codexSessions.map((session) => ({
        threadIds: session.startedThreadIds,
        messages: session.messages,
        approvalCalls: session.approvalCalls,
        stderr: session.stderr,
      })),
      copilotSessions: copilotSessions.map((session) => ({
        sessionId: session.started ? session.sessionId : undefined,
        events: session.events,
        hookCalls: session.hookCalls,
        permissionCalls: session.permissionCalls,
      })),
    };
  }
}

async function startCopilotSession(
  copilotHome: string,
  token: string | undefined,
  spec: CopilotSessionSpec,
  signal: AbortSignal,
): Promise<CopilotSession> {
  if (token === undefined) {
    throw new CheckSkipped(
      `No Copilot token: give a fine-grained PAT with the "Copilot Requests" permission in ${COPILOT_TOKEN_VARIABLE}`,
    );
  }
  return CopilotSession.start({ home: copilotHome, token }, spec, signal);
}

async function startCodexSession(
  codexHome: string | undefined,
  spec: CodexSessionSpec,
  signal: AbortSignal,
): Promise<CodexSession> {
  if (codexHome === undefined) {
    throw new CheckSkipped(
      "No Codex folder: give a signed-in one with --codex-home <folder> or ENGINE_CHECK_CODEX_HOME",
    );
  }
  const session = await CodexSession.start(codexHome, spec, signal);
  if (session.account === null) {
    await session.close();
    throw new CheckSkipped(
      `The Codex folder ${codexHome} is not signed in: sign it in with CODEX_HOME=<folder> codex login`,
    );
  }
  return session;
}

/**
 * Deletes the threads the check started from the account folder, through a session of its own, as a
 * check may have closed the session that started them; a check that started none starts no session.
 */
async function deleteCodexThreads(
  codexHome: string,
  codexSessions: readonly CodexSession[],
): Promise<void> {
  const threadIds = [...new Set(codexSessions.flatMap((session) => session.startedThreadIds))];
  if (threadIds.length === 0) {
    return;
  }
  const cleanup = await CodexSession.start(
    codexHome,
    { repository: tmpdir() },
    AbortSignal.timeout(60_000),
  );
  try {
    await cleanup.deleteThreads(threadIds);
  } finally {
    await cleanup.close();
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
