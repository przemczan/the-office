import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Check, Platform } from "./check.ts";
import { DECISION_WAIT_VARIABLE, DEFAULT_DECISION_WAIT_MINUTES } from "./checks/engine/decision-wait.ts";
import { checks } from "./checks/index.ts";
import { loadExpectations, recordObservations } from "./expectations.ts";
import { runCheck, sumTokens, type CheckOutcome } from "./run-checks.ts";

const USAGE = `Usage: npm run engine-check -- [--only <id prefix>]... [--include-slow] [--record]

Runs the engine checks on this platform and compares each observation with the one recorded in
expectations.json. Exits non-zero when a check differs, has no recorded result or fails.

  --only <prefix>   run only checks whose id starts with the prefix (repeatable)
  --include-slow    also run the slow checks, which are left out otherwise, even when --only names them
  --record          write this run's observations into expectations.json for this platform

Slow checks:
  engine.decision-wait  waits ${DECISION_WAIT_VARIABLE} (default ${DEFAULT_DECISION_WAIT_MINUTES}) before answering
                        a Decision, to see the answer continue the work past the 1-hour cache
`;

const toolRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const expectationsPath = join(toolRoot, "expectations.json");

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      only: { type: "string", multiple: true, default: [] },
      "include-slow": { type: "boolean", default: false },
      record: { type: "boolean", default: false },
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

  const expectations = await loadExpectations(expectationsPath);
  const outcomes: CheckOutcome[] = [];
  for (const check of selected) {
    process.stdout.write(`${check.id}: ${check.title}\n`);
    const outcome = await runCheck(check, expectations, platform);
    outcomes.push(outcome);
    process.stdout.write(describeOutcome(outcome));
  }

  const reportPath = await writeReport(platform, outcomes);
  if (values.record) {
    const observations = outcomes.flatMap((outcome) => (outcome.observed === undefined ? [] : [[outcome.id, outcome.observed] as const]));
    await recordObservations(expectationsPath, platform, Object.fromEntries(observations));
  }
  process.stdout.write(describeSummary(outcomes, reportPath, values.record));

  const failed = outcomes.some((outcome) => outcome.status === "failed");
  const mismatched = outcomes.some((outcome) => outcome.status !== "matches");
  return failed || (mismatched && !values.record) ? 1 : 0;
}

function currentPlatform(): Platform {
  if (process.platform === "win32" || process.platform === "linux") {
    return process.platform;
  }
  throw new Error(`The engine check runs on Windows and Linux, not ${process.platform}`);
}

function selectChecks(all: readonly Check[], platform: Platform, prefixes: readonly string[], includeSlow: boolean): Check[] {
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
      lines.push(`  ${path}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`);
    }
  }
  if (outcome.error !== undefined) {
    lines.push(...outcome.error.split("\n").map((line) => `  ${line}`));
  }
  return `${lines.join("\n")}\n`;
}

function describeSummary(outcomes: readonly CheckOutcome[], reportPath: string, recorded: boolean): string {
  const count = (status: CheckOutcome["status"]): number => outcomes.filter((outcome) => outcome.status === status).length;
  const { input, output, cacheRead, cacheCreation } = sumTokens(outcomes.map((outcome) => outcome.tokens));
  return [
    "",
    `${count("matches")} match, ${count("differs")} differ, ${count("unrecorded")} unrecorded, ${count("failed")} failed`,
    `Tokens: in ${input}, out ${output}, cache read ${cacheRead}, cache write ${cacheCreation}`,
    `Report with every session's messages and hook calls: ${reportPath}`,
    ...(recorded ? [`Recorded observations into ${expectationsPath}`] : []),
    "",
  ].join("\n");
}

async function writeReport(platform: Platform, outcomes: readonly CheckOutcome[]): Promise<string> {
  const reportPath = join(toolRoot, "out", `report-${platform}.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ platform, ranAt: new Date().toISOString(), outcomes }, null, 2)}\n`);
  return reportPath;
}

process.exitCode = await main();
