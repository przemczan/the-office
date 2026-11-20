import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Check, Platform } from "./check.ts";
import { API_KEY_FILE_VARIABLE } from "./checks/engine/api-key.ts";
import {
  DECISION_WAIT_VARIABLE,
  DEFAULT_DECISION_WAIT_MINUTES,
} from "./checks/engine/decision-wait.ts";
import { DEFAULT_LONG_TOOL_MINUTES, LONG_TOOL_VARIABLE } from "./checks/engine/long-office-tool.ts";
import { checks } from "./checks/index.ts";
import { COPILOT_TOKEN_VARIABLE } from "./copilot-cli/options.ts";
import { loadExpectations, recordObservations } from "./expectations.ts";
import { GEMINI_API_KEY_FILE_VARIABLE } from "./gemini/options.ts";
import { runCheck, sumTokens, type CheckOutcome } from "./run-checks.ts";

const CODEX_HOME_VARIABLE = "ENGINE_CHECK_CODEX_HOME";
const SECOND_CLAUDE_CONFIG_VARIABLE = "ENGINE_CHECK_SECOND_CLAUDE_CONFIG";

const USAGE = `Usage: npm run engine-check -- [--only <id prefix>]... [--include-slow] [--record]
                                [--codex-home <folder>] [--second-claude-config <folder>]

Runs the engine checks on this platform and compares each observation with the one recorded in
expectations.json. Exits non-zero when a check differs, has no recorded result or fails; a check
that can't observe what it is for on this account now is skipped, with the reason.

  --only <prefix>   run only checks whose id starts with the prefix (repeatable)
  --include-slow    also run the slow checks, which are left out otherwise, even when --only names them
  --record          write this run's observations into expectations.json for this platform
  --codex-home <folder>
                    the Codex folder the codex.* checks run with as CODEX_HOME, signed in with
                    CODEX_HOME=<folder> codex login; ${CODEX_HOME_VARIABLE} when omitted. Without
                    a signed-in folder the codex.* checks are skipped. The check changes no setting
                    there, and deletes the threads it started.
  --second-claude-config <folder>
                    a second Claude Code config folder, signed in with
                    CLAUDE_CONFIG_DIR=<folder> claude auth login, which engine.session-carry-over
                    and fallback.session-carry-over carry a session to from the account the other
                    checks run on; ${SECOND_CLAUDE_CONFIG_VARIABLE} when omitted. Without a
                    signed-in folder those checks are skipped. The check removes the session it
                    carried there.

Environment:
  ${API_KEY_FILE_VARIABLE}
                    a file holding an Anthropic API key, which engine.api-key-sign-in signs a config
                    folder of its own in with; without it that check is skipped. The key is never
                    printed or recorded.
  ${COPILOT_TOKEN_VARIABLE}
                    a GitHub token with Copilot access (a fine-grained PAT with the "Copilot
                    Requests" permission), which the copilot.* checks sign the pinned Copilot runtime
                    in with, in a config folder of their own; without it they are skipped. The
                    user's own ~/.copilot is never read or written, and the token is never recorded.
  ${GEMINI_API_KEY_FILE_VARIABLE}
                    a file holding a Gemini API key (Google AI Studio), which the gemini.* checks
                    give each Gemini session in its environment, in an engine folder of the
                    check's own; without it they are skipped. The key is never printed or recorded.

Slow checks:
  engine.decision-wait  waits ${DECISION_WAIT_VARIABLE} (default ${DEFAULT_DECISION_WAIT_MINUTES}) before answering
                        a Decision, to see the answer continue the work past the 1-hour cache
  engine.long-office-tool, fallback.long-office-tool
                        an Office tool answers after ${LONG_TOOL_VARIABLE} (default
                        ${DEFAULT_LONG_TOOL_MINUTES}), to see neither route cut a long call short
`;

const toolRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const expectationsPath = join(toolRoot, "expectations.json");

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      only: { type: "string", multiple: true, default: [] },
      "include-slow": { type: "boolean", default: false },
      record: { type: "boolean", default: false },
      "codex-home": { type: "string" },
      "second-claude-config": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const platform = currentPlatform();
  const selected = selectChecks(checks, platform, values.only, values["include-slow"]);
  if (selected.length === 0) {
    process.stderr.write(`No checks selected for ${platform}.\n`);
    return 1;
  }

  const codexHome = folderFromWhereNpmRan(values["codex-home"] ?? process.env[CODEX_HOME_VARIABLE]);
  if (codexHome !== undefined && !existsSync(codexHome)) {
    process.stderr.write(`The Codex folder ${codexHome} does not exist.\n`);
    return 1;
  }
  const secondClaudeConfig = folderFromWhereNpmRan(
    values["second-claude-config"] ?? process.env[SECOND_CLAUDE_CONFIG_VARIABLE],
  );
  if (secondClaudeConfig !== undefined && !existsSync(secondClaudeConfig)) {
    process.stderr.write(`The Claude Code folder ${secondClaudeConfig} does not exist.\n`);
    return 1;
  }
  const copilotToken = process.env[COPILOT_TOKEN_VARIABLE];
  const geminiApiKeyFile = folderFromWhereNpmRan(process.env[GEMINI_API_KEY_FILE_VARIABLE]);
  const geminiApiKey =
    geminiApiKeyFile === undefined ? undefined : (await readFile(geminiApiKeyFile, "utf8")).trim();
  const runOptions = {
    ...(geminiApiKey === undefined || geminiApiKey === "" ? {} : { geminiApiKey }),
    ...(codexHome === undefined ? {} : { codexHome }),
    ...(copilotToken === undefined || copilotToken === "" ? {} : { copilotToken }),
    ...(secondClaudeConfig === undefined ? {} : { secondClaudeConfig }),
  };
  const expectations = await loadExpectations(expectationsPath);
  const outcomes: CheckOutcome[] = [];
  for (const check of selected) {
    process.stdout.write(`${check.id}: ${check.title}\n`);
    const outcome = await runCheck(check, expectations, platform, runOptions);
    outcomes.push(outcome);
    process.stdout.write(describeOutcome(outcome));
  }

  const reportPath = await writeReport(platform, outcomes);
  if (values.record) {
    const observations = outcomes.flatMap((outcome) =>
      outcome.observed === undefined ? [] : [[outcome.id, outcome.observed] as const],
    );
    await recordObservations(expectationsPath, platform, Object.fromEntries(observations));
  }
  process.stdout.write(describeSummary(outcomes, reportPath, values.record));

  const failed = outcomes.some((outcome) => outcome.status === "failed");
  const mismatched = outcomes.some(
    (outcome) => outcome.status !== "matches" && outcome.status !== "skipped",
  );
  return failed || (mismatched && !values.record) ? 1 : 0;
}

/** A relative folder is taken from where npm was run, not from the workspace npm runs the check in. */
function folderFromWhereNpmRan(given: string | undefined): string | undefined {
  if (given === undefined || given === "") {
    return undefined;
  }
  return resolve(process.env["INIT_CWD"] ?? process.cwd(), given);
}

function currentPlatform(): Platform {
  if (process.platform === "win32" || process.platform === "linux") {
    return process.platform;
  }
  throw new Error(`The engine check runs on Windows and Linux, not ${process.platform}`);
}

function selectChecks(
  all: readonly Check[],
  platform: Platform,
  prefixes: readonly string[],
  includeSlow: boolean,
): Check[] {
  return all.filter(
    (check) =>
      (check.platforms?.includes(platform) ?? true) &&
      (includeSlow || check.slow !== true) &&
      (prefixes.length === 0 || prefixes.some((prefix) => check.id.startsWith(prefix))),
  );
}

function describeOutcome(outcome: CheckOutcome): string {
  const { input, output, cacheRead, cacheCreation } = outcome.tokens;
  const lines = [
    `  ${outcome.status} in ${(outcome.durationMs / 1000).toFixed(1)} s; tokens in ${input}, out ${output}, cache read ${cacheRead}, cache write ${cacheCreation}`,
  ];
  if (outcome.status === "unrecorded") {
    lines.push(`  observed ${JSON.stringify(outcome.observed)}`);
  }
  if (outcome.status === "differs") {
    for (const { path, expected, observed } of outcome.differences) {
      lines.push(
        `  ${path}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`,
      );
    }
  }
  if (outcome.reason !== undefined) {
    lines.push(`  ${outcome.reason}`);
  }
  if (outcome.error !== undefined) {
    lines.push(...outcome.error.split("\n").map((line) => `  ${line}`));
  }
  return `${lines.join("\n")}\n`;
}

function describeSummary(
  outcomes: readonly CheckOutcome[],
  reportPath: string,
  recorded: boolean,
): string {
  const count = (status: CheckOutcome["status"]): number =>
    outcomes.filter((outcome) => outcome.status === status).length;
  const { input, output, cacheRead, cacheCreation } = sumTokens(
    outcomes.map((outcome) => outcome.tokens),
  );
  return [
    "",
    `${count("matches")} match, ${count("differs")} differ, ${count("unrecorded")} unrecorded, ${count("skipped")} skipped, ${count("failed")} failed`,
    `Tokens: in ${input}, out ${output}, cache read ${cacheRead}, cache write ${cacheCreation}`,
    `Report with every session's messages, events, hook calls and approval calls: ${reportPath}`,
    ...(recorded ? [`Recorded observations into ${expectationsPath}`] : []),
    "",
  ].join("\n");
}

async function writeReport(platform: Platform, outcomes: readonly CheckOutcome[]): Promise<string> {
  const reportPath = join(toolRoot, "out", `report-${platform}.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify({ platform, ranAt: new Date().toISOString(), outcomes }, null, 2)}\n`,
  );
  return reportPath;
}

process.exitCode = await main();
