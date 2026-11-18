import type {
  SDKMessage,
  SDKRateLimitEvent,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CheckSkipped, type Check, type Observation } from "../../check.ts";
import { pinnedBinaryPath } from "../../claude-code-p/pinned-binary.ts";
import type { Json } from "../../json.ts";
import type { ProbeHook } from "../../probe-session.ts";
import { sessionEnvironment } from "../../session-environment.ts";
import { sortedNames } from "../observations.ts";
import { toolDecision } from "../permissions/hook-decisions.ts";
import { lastOutcome, toolCalls, toolResultText } from "../tool-calls.ts";
import {
  API_KEY_FILE,
  API_KEY_FILE_VARIABLE,
  apiKeyFileFrom,
  holdsPartOf,
  printFileCommand,
  redactKey,
  redactKeyInPlace,
  variableNames,
} from "./api-key.ts";

/** The one command the Agent runs: it prints the environment the engine gives its commands. */
const ENV_COMMAND = "env";
const STATUS_TIMEOUT_MS = 30_000;

/**
 * A Claude Code engine signed in by an Anthropic API key, as The Office signs one in (spec §5.4, §6):
 * a config folder with no login, the key in its owner-only `.anthropic-api-key`, and `apiKeyHelper`
 * in the session settings printing that file; the key in no environment. One short turn on the
 * cheapest model, in which the Agent runs `env`. Recorded: whether the turn answered, `init`'s
 * `apiKeySource`, what `claude auth status --json` says on the folder (without the settings), whether
 * the commands' environment holds any part of the key or names `ANTHROPIC_API_KEY`, and what the
 * `rate_limit_event`s carry on an API key. The key itself is never recorded: the session's messages
 * and hook calls are redacted before the report keeps them. Skipped without `ENGINE_CHECK_API_KEY_FILE`.
 */
export const apiKeySignInCheck: Check = {
  id: "engine.api-key-sign-in",
  title:
    "an engine signed in by an API key through apiKeyHelper answers, and no command's environment holds the key",
  async run({ sandbox, startSession }) {
    const choice = apiKeyFileFrom(process.env);
    if ("skipped" in choice) throw new CheckSkipped(choice.skipped);
    const key = (await readFile(choice.file, "utf8")).trim();
    if (key === "") throw new Error(`${API_KEY_FILE_VARIABLE} names an empty file`);

    const configFolder = join(sandbox.officeData, "engines", "claude-code");
    await mkdir(configFolder, { recursive: true, mode: 0o700 });
    const keyFile = join(configFolder, API_KEY_FILE);
    await writeFile(keyFile, key, { flag: "wx", mode: 0o600 });
    const environment = { ...sessionEnvironment(), CLAUDE_CONFIG_DIR: configFolder };

    const authStatus = redactKey(await readAuthStatus(environment), key);

    const session = await startSession({
      repository: await sandbox.createRepository(),
      settings: { apiKeyHelper: printFileCommand(keyFile) },
      hooks: { PreToolUse: allowEnvOnly },
      options: { env: environment },
    });
    session.send(
      `Run the shell command \`${ENV_COMMAND}\` with the Bash tool, exactly that command and nothing else, then reply with just OK.`,
    );
    const result = await session.nextResult();
    await session.close();

    const envCalls = toolCalls(session.messages).filter(
      (call) => call.name === "Bash" && String(call.input["command"]).trim() === ENV_COMMAND,
    );
    const lastEnvCall = envCalls.at(-1);
    const envOutput =
      lastEnvCall === undefined ? "" : toolResultText(session.messages, lastEnvCall.id);
    const observation: Observation = {
      answered: result.subtype === "success" && !result.is_error,
      result: { subtype: result.subtype, isError: result.is_error },
      apiKeySource: initOf(session.messages)?.apiKeySource ?? null,
      authStatus,
      envCommand: lastOutcome(envCalls),
      envHoldsPartOfKey: holdsPartOf(envOutput, key),
      envNamesAnthropicApiKey: envOutput.includes("ANTHROPIC_API_KEY"),
      envEngineVariables: variableNames(envOutput, ["ANTHROPIC", "CLAUDE"]),
      rateLimitEvents: rateLimitEventsSeen(session.messages),
    };
    redactKeyInPlace(session.messages, key);
    redactKeyInPlace(session.hookCalls, key);
    return redactKey(observation, key);
  },
};

/** Allows the Agent's `env` and refuses any other command, so the session does nothing else. */
const allowEnvOnly: ProbeHook = async (input) => {
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return {};
  const { command } = input.tool_input as { command?: unknown };
  return String(command).trim() === ENV_COMMAND
    ? toolDecision("allow")
    : toolDecision("deny", `Run only \`${ENV_COMMAND}\`.`);
};

/**
 * `claude auth status --json` on the folder, run as The Office runs it: the session's environment,
 * no settings, so no `apiKeyHelper`. Signed out exits 1 and still prints its status. Its fields are
 * kept when they are booleans, numbers or strings, by name.
 */
function readAuthStatus(environment: Record<string, string>): Promise<Observation> {
  return new Promise((resolve) => {
    execFile(
      pinnedBinaryPath(),
      ["auth", "status", "--json"],
      { env: environment, timeout: STATUS_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        const exitCode = error === null ? 0 : typeof error.code === "number" ? error.code : null;
        resolve({ exitCode, fields: statusFields(stdout) });
      },
    );
  });
}

function statusFields(stdout: string): Json {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return stdout.trim() === "" ? "no output" : "not JSON";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return "not an object";
  return Object.fromEntries(
    Object.entries(parsed)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([name, value]): [string, Json] => [
        name,
        typeof value === "boolean" || typeof value === "number" || typeof value === "string"
          ? value
          : value === null
            ? null
            : `(${Array.isArray(value) ? "array" : typeof value})`,
      ]),
  );
}

function initOf(messages: readonly SDKMessage[]): SDKSystemMessage | undefined {
  return messages.find(
    (message): message is SDKSystemMessage =>
      message.type === "system" && message.subtype === "init",
  );
}

/** What the turn's `rate_limit_event`s carry: their statuses, window types and field names. */
function rateLimitEventsSeen(messages: readonly SDKMessage[]): Observation {
  const events = messages.filter(
    (message): message is SDKRateLimitEvent => message.type === "rate_limit_event",
  );
  return {
    arrived: events.length > 0,
    statuses: sortedNames(events.map(({ rate_limit_info: info }) => String(info.status))),
    rateLimitTypes: sortedNames(
      events.flatMap(({ rate_limit_info: info }) =>
        info.rateLimitType === undefined ? [] : [String(info.rateLimitType)],
      ),
    ),
    fields: sortedNames(events.flatMap(({ rate_limit_info: info }) => Object.keys(info))),
  };
}
