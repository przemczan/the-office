import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { logs, metrics, trace } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_GRAFANA_IMAGE } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana.js";
import { Telemetry, TELEMETRY_SCOPE } from "../../../../platform/telemetry/telemetry.js";
import type { CostliestSpend, UsageSeries, WindowSeries } from "../../domain/full-stats.js";
import type { GrafanaAccess, SteppedRange } from "../../ports/stats-source.js";
import { callGrafana } from "./grafana-http.js";
import {
  costliestBreakdownQueryBody,
  costliestTopQueryBody,
  usageQueryBody,
  windowsQueryBody,
} from "./grafana-queries.js";
import {
  countedTokensOf,
  rerecord,
  SCENARIO,
  SCENARIO_CALLS,
  type RecordingName,
  type ScenarioCall,
} from "./grafana-scenario.fixtures.js";
import { GrafanaStatsSource } from "./grafana-stats-source.js";

/**
 * The live check of the Grafana adapter (apps/service/docs/testing.md, "The Grafana live check"):
 * a throwaway grafana/otel-lgtm at the pinned image, fed the scenario through the real Telemetry
 * over OTLP and read back through GrafanaStatsSource, which confirms the metric, label and data
 * source names `grafana-queries.ts` holds. With OFFICE_GRAFANA_RERECORD=1 it rewrites
 * `recorded/*.json` from what that Grafana answers.
 */
const run = promisify(execFile);
const LIVE = process.env.OFFICE_GRAFANA_LIVE_CHECK === "1";
const RERECORD = process.env.OFFICE_GRAFANA_RERECORD === "1";
const STEP_SECONDS = 600;

async function dockerMissing(): Promise<string | undefined> {
  if (!LIVE) return "OFFICE_GRAFANA_LIVE_CHECK isn't 1";
  try {
    await run("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 20_000 });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message.split("\n")[0] : String(error);
  }
}

const missing = await dockerMissing();

describe.skipIf(missing !== undefined)(
  `GrafanaStatsSource on a live grafana/otel-lgtm${missing ? ` (skipped: ${missing})` : ""}`,
  { timeout: 300_000 },
  () => {
    // Never the bundled Grafana's Compose project nor a container named `the-office-grafana`,
    // which The Office would take for an earlier bundled Grafana.
    const container = `office-grafana-live-check-${randomBytes(4).toString("hex")}`;
    let access: GrafanaAccess;
    let range: SteppedRange;
    const source = new GrafanaStatsSource();

    beforeAll(async () => {
      await run(
        "docker",
        [
          "run",
          "--detach",
          "--rm",
          "--name",
          container,
          "--publish",
          "127.0.0.1::3000",
          "--publish",
          "127.0.0.1::4318",
          BUNDLED_GRAFANA_IMAGE,
        ],
        { timeout: 240_000 },
      );
      const grafana = await hostAddress(container, 3000);
      const otlp = await hostAddress(container, 4318);
      access = { address: grafana };
      await until(async () => {
        const { stdout } = await run("docker", ["logs", container], { timeout: 20_000 });
        return stdout.includes("up and running");
      }, 180_000);

      // One hour of 10-minute steps from the step The Office is in, as the recordings hold.
      const stepMs = STEP_SECONDS * 1000;
      const from = Math.floor(Date.now() / stepMs) * stepMs;
      range = { from: new Date(from), to: new Date(from + 6 * stepMs), stepSeconds: STEP_SECONDS };

      await sendScenario(otlp);
    }, 600_000);

    afterAll(async () => {
      await run("docker", ["rm", "--force", container], { timeout: 60_000 }).catch(() => undefined);
    });

    it("finds otel-lgtm's Prometheus and Loki by their uids, read anonymously", async () => {
      const listed = await callGrafana(access, "/api/datasources", 10_000);

      expect(listed).toMatchObject({ kind: "answered", status: 200 });
      expect(await source.findDataSources(access)).toMatchObject({
        kind: "read",
        value: {
          prometheus: { uid: "prometheus", name: expect.any(String) },
          loki: { uid: "loki", name: expect.any(String) },
        },
      });
    });

    it("reads back what Telemetry sent, by the names grafana-queries.ts holds", async () => {
      let usage: UsageSeries | undefined;
      let costliest: CostliestSpend | undefined;
      let windows: readonly WindowSeries[] | undefined;
      await until(async () => {
        const read = await Promise.all([
          source.usage(access, { ...range, split: "model", projectNames: undefined }),
          source.costliest(access, { ...range, limit: 10, projectNames: undefined }),
          source.windows(access, range),
        ]);
        if (read[0].kind === "read") usage = read[0].value;
        if (read[1].kind === "read") costliest = read[1].value;
        if (read[2].kind === "read") windows = read[2].value;
        const runs = costliest?.tasks.flatMap((task) => task.runs).length ?? 0;
        return (
          (usage?.tokens.length ?? 0) === 2 &&
          runs === SCENARIO_CALLS.filter((call) => call.task !== "").length &&
          (costliest?.initiatives[0]?.tasks.length ?? 0) === 2 &&
          (windows?.length ?? 0) === 2
        );
      }, 120_000);

      expect(usage?.tokens.map((series) => series.name).toSorted()).toEqual([
        "claude-haiku-5",
        "claude-sonnet-5",
      ]);
      const firstTask = costliest?.tasks.find((task) => task.taskId === SCENARIO.firstTask);
      const firstCalls = SCENARIO_CALLS.filter((call) => call.task === SCENARIO.firstTask);
      expect(firstTask?.runs.map((r) => [r.stageName, r.stageRun, r.tokens])).toEqual(
        firstCalls.map((call) => [call.stage, call.stageRun, countedTokensOf(call)]),
      );
      expect(costliest?.initiatives[0]?.initiativeId).toBe(SCENARIO.initiative);
      expect(
        Object.fromEntries(
          (windows ?? []).map((series) => [series.window, series.points.at(-1)?.value]),
        ),
      ).toEqual({ five_hour: SCENARIO.fiveHourPercent, seven_day: SCENARIO.sevenDayPercent });

      if (RERECORD) await rerecordAll(access, range);
    });
  },
);

/** Sends the scenario through the real Telemetry, exported over OTLP to the container. */
async function sendScenario(otlp: string): Promise<void> {
  const sdk = new NodeSDK({
    serviceName: "the-office",
    spanProcessors: [
      new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: `${otlp}/v1/traces` }) }),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${otlp}/v1/metrics` }),
        exportIntervalMillis: 1_000,
        exportTimeoutMillis: 1_000,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${otlp}/v1/logs` }) }),
    ],
    instrumentations: [],
  });
  sdk.start();
  const telemetry = new Telemetry(
    trace.getTracer(TELEMETRY_SCOPE),
    metrics.getMeter(TELEMETRY_SCOPE),
    logs.getLogger(TELEMETRY_SCOPE),
  );
  // Prometheus can't tell a counter's first sample from its rise, so each series starts at 0
  // and is exported before the calls count.
  await telemetry.inSpan("zero", {}, async (span) => {
    for (const call of SCENARIO_CALLS) {
      const zero = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
      telemetry.recordTokens(span, zero, metricOf(call));
      telemetry.recordCost(span, 0, metricOf(call));
    }
  });
  await sleep(3_000);
  for (const call of SCENARIO_CALLS) {
    await telemetry.inSpan("engine call", {}, async (span) => {
      telemetry.recordTokens(span, call.tokens, metricOf(call));
      telemetry.recordCost(span, call.estimatedUsd, metricOf(call));
      telemetry.recordEngineCall({
        "office.task": call.task,
        "office.initiative": call.initiative,
        "office.thread": "",
        "office.stage": call.stage,
        "office.stage.run": call.stageRun,
        "office.role": call.role,
        "office.pipeline": call.pipeline,
        "office.project": call.project,
        "office.engine": SCENARIO.engineId,
        "office.engine.model": call.model,
        "office.engine.outcome": "completed",
        "office.engine.call.duration_ms": 1_000,
        "office.tokens.input": call.tokens.input,
        "office.tokens.output": call.tokens.output,
        "office.tokens.cache_read": call.tokens.cacheRead,
        "office.tokens.cache_creation": call.tokens.cacheCreation,
        "office.cost.estimated_usd": call.estimatedUsd,
      });
    });
    // Each run's first record a second apart, so their order is the order sent.
    await sleep(1_100);
  }
  telemetry.recordUsageWindow(SCENARIO.engineId, "five_hour", SCENARIO.fiveHourPercent);
  telemetry.recordUsageWindow(SCENARIO.engineId, "seven_day", SCENARIO.sevenDayPercent);
  await sleep(3_000);
  await sdk.shutdown();
}

/** A call's metric attributes, as a Stage's or a Thread's session tags them. */
function metricOf(call: ScenarioCall) {
  return {
    "office.engine.model": call.model,
    "office.prompt.features": "",
    "office.conversation.home": call.task === "" ? "initiative" : "task",
    "office.role": call.role,
    "office.stage": call.stage,
    "office.pipeline": call.pipeline,
    "office.project": call.project,
  };
}

/** Rewrites the recordings from what this Grafana answers to the adapter's own queries. */
async function rerecordAll(access: GrafanaAccess, range: SteppedRange): Promise<void> {
  const prometheus = { type: "prometheus", uid: "prometheus" };
  const loki = { type: "loki", uid: "loki" };
  const recordedRange = {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    stepSeconds: range.stepSeconds,
  };
  const save = async (name: RecordingName, path: string, body?: unknown, keepRange = true) => {
    const answer = await callGrafana(access, path, 10_000, body);
    if (answer.kind !== "answered") throw new Error(`${name}: ${answer.problem}`);
    await rerecord(name, {
      range: keepRange ? recordedRange : null,
      status: answer.status,
      body: answer.body,
    });
  };
  const costliest = { ...range, limit: 10, projectNames: undefined };
  await save("data-sources", "/api/datasources", undefined, false);
  await save(
    "usage",
    "/api/ds/query",
    usageQueryBody(prometheus, { ...range, split: "model", projectNames: undefined }),
  );
  await save("windows", "/api/ds/query", windowsQueryBody(prometheus, range));
  await save("costliest-top", "/api/ds/query", costliestTopQueryBody(loki, costliest));
  await save(
    "costliest-breakdown",
    "/api/ds/query",
    costliestBreakdownQueryBody(
      loki,
      costliest,
      [SCENARIO.firstTask, SCENARIO.secondTask],
      [SCENARIO.initiative],
    ),
  );
  const broken = usageQueryBody(prometheus, { ...range, split: "model", projectNames: undefined });
  await save("data-source-error", "/api/ds/query", {
    ...broken,
    queries: broken.queries.map((query) =>
      query.refId === "tokens" ? { ...query, expr: `${query.expr.slice(0, 40)}}` } : query,
    ),
  });
}

/** Where the container's port is published on the host. */
async function hostAddress(container: string, port: number): Promise<string> {
  const { stdout } = await run("docker", ["port", container, `${port}/tcp`], { timeout: 20_000 });
  const published = stdout.split("\n").find((line) => line.startsWith("127.0.0.1:"));
  if (!published) throw new Error(`${container} publishes no port ${port}: ${stdout}`);
  return `http://${published.trim()}`;
}

async function until(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await sleep(2_000);
  }
  throw new Error(`Not so within ${timeoutMs / 1000} s.`);
}
