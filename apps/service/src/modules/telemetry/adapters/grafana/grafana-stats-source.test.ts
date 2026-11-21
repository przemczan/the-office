import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closedPort, FakeGrafana } from "./fake-grafana.fixtures.js";
import {
  countedTokensOf as counted,
  recorded,
  recordedRange,
  SCENARIO,
  SCENARIO_CALLS,
  type ScenarioCall,
} from "./grafana-scenario.fixtures.js";
import { GrafanaStatsSource } from "./grafana-stats-source.js";

function byModel(series: readonly { name: string; points: readonly { value: number }[] }[]) {
  return Object.fromEntries(
    series.map(({ name, points }) => [name, points.reduce((sum, p) => sum + p.value, 0)]),
  );
}

function expected(model: string, of: (call: ScenarioCall) => number): number {
  return SCENARIO_CALLS.filter((call) => call.model === model).reduce((sum, c) => sum + of(c), 0);
}

/** `increase` extrapolates over its window, so a live recording's totals are near, not exact. */
function near(actual: number | undefined, wanted: number): void {
  expect(Math.abs((actual ?? 0) - wanted)).toBeLessThanOrEqual(wanted * 0.25);
}

describe("GrafanaStatsSource", () => {
  let grafana: FakeGrafana;
  let source: GrafanaStatsSource;

  beforeEach(async () => {
    grafana = await FakeGrafana.start();
    source = new GrafanaStatsSource();
  });

  afterEach(async () => {
    await grafana.stop();
  });

  it("reads tokens and cost by model from Prometheus, anonymously, each point at its step's start", async () => {
    const range = recordedRange("usage");
    const answer = await source.usage(
      { address: grafana.address },
      { ...range, split: "model", projectNames: undefined },
    );

    expect(grafana.requests.map((request) => request.headers.authorization)).toEqual([
      undefined,
      undefined,
    ]);
    const [body] = grafana.queries();
    expect(body).toMatchObject({
      from: String(range.from.getTime()),
      to: String(range.to.getTime()),
    });
    expect(body?.queries).toMatchObject([
      {
        refId: "tokens",
        datasource: { type: "prometheus", uid: "prometheus" },
        expr: 'sum by (office_engine_model) (increase(office_tokens_total{office_token_type!="cache_read"}[600s]))',
        interval: "600s",
        intervalMs: 600_000,
      },
      {
        refId: "cost",
        datasource: { type: "prometheus", uid: "prometheus" },
        expr: "sum by (office_engine_model) (increase(office_cost_USD_total{}[600s]))",
      },
    ]);

    expect(answer.kind).toBe("read");
    if (answer.kind !== "read") return;
    const tokens = byModel(answer.value.tokens);
    expect(Object.keys(tokens).toSorted()).toEqual(["claude-haiku-5", "claude-sonnet-5"]);
    near(tokens["claude-haiku-5"], expected("claude-haiku-5", counted));
    near(tokens["claude-sonnet-5"], expected("claude-sonnet-5", counted));
    near(
      byModel(answer.value.estimatedCostUsd)["claude-sonnet-5"],
      expected("claude-sonnet-5", (call) => call.estimatedUsd),
    );
    const stepMs = range.stepSeconds * 1000;
    for (const { at } of answer.value.tokens.flatMap((series) => series.points)) {
      expect((at.getTime() - range.from.getTime()) % stepMs).toBe(0);
      expect(at.getTime()).toBeGreaterThanOrEqual(range.from.getTime());
      expect(at.getTime()).toBeLessThanOrEqual(range.to.getTime() - stepMs);
    }
  });

  it("splits by Project and narrows to the Projects named, escaped, with the token as Bearer", async () => {
    await source.usage(
      { address: grafana.address, token: "glsa_read" },
      { ...recordedRange("usage"), split: "project", projectNames: ["Admin panel", 'A.b "c"'] },
    );

    expect(grafana.requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer glsa_read",
      "Bearer glsa_read",
    ]);
    expect(grafana.queries()[0]?.queries.map((query) => query.expr)).toEqual([
      'sum by (office_project) (increase(office_tokens_total{office_token_type!="cache_read",office_project=~"Admin panel|A\\\\.b \\"c\\""}[600s]))',
      'sum by (office_project) (increase(office_cost_USD_total{office_project=~"Admin panel|A\\\\.b \\"c\\""}[600s]))',
    ]);
  });

  it("totals the costliest Tasks and Initiatives in Loki, each Stage run with its first record", async () => {
    const range = recordedRange("costliest-top");
    const answer = await source.costliest(
      { address: grafana.address },
      { from: range.from, to: range.to, limit: 10, projectNames: undefined },
    );

    const [top, breakdown] = grafana.queries();
    expect(top?.queries).toEqual([
      {
        refId: "topTasks",
        datasource: { type: "loki", uid: "loki" },
        queryType: "instant",
        expr: 'topk(10, sum by (office_task) (sum_over_time({service_name="the-office"} |= "office.engine.call" | office_task!="" | unwrap office_cost_estimated_usd | __error__="" [3600s])))',
      },
      {
        refId: "topInitiatives",
        datasource: { type: "loki", uid: "loki" },
        queryType: "instant",
        expr: 'topk(10, sum by (office_initiative) (sum_over_time({service_name="the-office"} |= "office.engine.call" | office_initiative!="" | unwrap office_cost_estimated_usd | __error__="" [3600s])))',
      },
    ]);
    const tasks = `office_task=~"${SCENARIO.firstTask}|${SCENARIO.secondTask}"`;
    expect(breakdown?.queries.map((query) => [query.refId, query.expr])).toEqual([
      [
        "taskCost",
        `sum by (office_task, office_stage, office_stage_run, office_engine, office_engine_model) (sum_over_time({service_name="the-office"} |= "office.engine.call" | ${tasks} | unwrap office_cost_estimated_usd | __error__="" [3600s]))`,
      ],
      ["taskInput", expect.stringContaining("| unwrap office_tokens_input |")],
      ["taskOutput", expect.stringContaining("| unwrap office_tokens_output |")],
      ["taskCacheCreation", expect.stringContaining("| unwrap office_tokens_cache_creation |")],
      [
        "taskFirst",
        `min by (office_task, office_stage, office_stage_run, office_engine, office_engine_model) (min_over_time({service_name="the-office"} |= "office.engine.call" | ${tasks} | label_format office_first_ms=\`{{ __timestamp__ | unixEpochMillis }}\` | unwrap office_first_ms | __error__="" [3600s]))`,
      ],
      [
        "initiativeCost",
        `sum by (office_initiative, office_task, office_stage_run, office_engine, office_engine_model) (sum_over_time({service_name="the-office"} |= "office.engine.call" | office_initiative=~"${SCENARIO.initiative}" | unwrap office_cost_estimated_usd | __error__="" [3600s]))`,
      ],
      ["initiativeInput", expect.any(String)],
      ["initiativeOutput", expect.any(String)],
      ["initiativeCacheCreation", expect.any(String)],
    ]);

    expect(answer.kind).toBe("read");
    if (answer.kind !== "read") return;
    const [first, second] = answer.value.tasks;
    expect(first?.taskId).toBe(SCENARIO.firstTask);
    expect(second?.taskId).toBe(SCENARIO.secondTask);
    const firstCalls = SCENARIO_CALLS.filter((call) => call.task === SCENARIO.firstTask);
    expect(first?.tokens).toBe(firstCalls.reduce((sum, call) => sum + counted(call), 0));
    expect(first?.estimatedCostUsd).toBeCloseTo(
      firstCalls.reduce((sum, call) => sum + call.estimatedUsd, 0),
    );
    // The tries in the order their first records came; the call outside a Stage has "" for both.
    expect(
      first?.runs.map((run) => [run.stageName, run.stageRun, run.engineId, run.model]),
    ).toEqual(firstCalls.map((call) => [call.stage, call.stageRun, call.engine, call.model]));
    expect(first?.runs.map((run) => run.tokens)).toEqual(firstCalls.map(counted));
    for (const run of first?.runs ?? []) {
      expect(run.firstAt.getTime()).toBeGreaterThanOrEqual(range.from.getTime());
      expect(run.firstAt.getTime()).toBeLessThanOrEqual(range.to.getTime());
    }

    const [initiative] = answer.value.initiatives;
    const initiativeCalls = SCENARIO_CALLS.filter(
      (call) => call.initiative === SCENARIO.initiative,
    );
    expect(initiative?.initiativeId).toBe(SCENARIO.initiative);
    expect(initiative?.tokens).toBe(initiativeCalls.reduce((sum, call) => sum + counted(call), 0));
    // One piece per call: each Task's Stage run on its engine and model.
    expect(
      initiative?.tasks
        .map((task) => [task.taskId, task.stageRun, task.engineId, task.model].join(" "))
        .toSorted(),
    ).toEqual(
      initiativeCalls
        .map((call) => [call.task, call.stageRun, call.engine, call.model].join(" "))
        .toSorted(),
    );
    const ownThreads = initiative?.tasks.find((task) => task.taskId === "");
    const ownCall = SCENARIO_CALLS.find((call) => call.task === "");
    expect(ownThreads?.estimatedCostUsd).toBeCloseTo(ownCall?.estimatedUsd ?? -1);
  });

  it("reads how full each engine's Usage windows were", async () => {
    const range = recordedRange("windows");
    const answer = await source.windows({ address: grafana.address }, range);

    expect(grafana.queries()[0]?.queries[0]).toMatchObject({
      datasource: { uid: "prometheus" },
      expr: "max by (office_engine, office_usage_window) (max_over_time(office_usage_window_used_percent[600s]))",
    });
    expect(answer.kind).toBe("read");
    if (answer.kind !== "read") return;
    const last = Object.fromEntries(
      answer.value.map((series) => [
        `${series.engineId} ${series.window}`,
        series.points.at(-1)?.value,
      ]),
    );
    expect(last).toEqual({
      [`${SCENARIO.engineId} five_hour`]: SCENARIO.fiveHourPercent,
      [`${SCENARIO.engineId} seven_day`]: SCENARIO.sevenDayPercent,
    });
  });

  it("answers rejected when Grafana refuses the token (401)", async () => {
    grafana.answers.set("/api/ds/query", {
      range: null,
      status: 401,
      body: { message: "Invalid API key" },
    });

    const answer = await source.windows(
      { address: grafana.address, token: "wrong" },
      recordedRange("windows"),
    );

    expect(answer).toEqual({ kind: "rejected" });
  });

  it("answers unreachable, in words, when nothing answers at the address", async () => {
    const address = `http://127.0.0.1:${await closedPort()}`;

    const answer = await source.windows({ address }, recordedRange("windows"));

    expect(answer).toEqual({ kind: "unreachable", problem: `Nothing answers at ${address}.` });
  });

  it("answers unreachable with the data source's own error", async () => {
    grafana.answers.set("/api/ds/query", recorded("data-source-error"));

    const answer = await source.usage(
      { address: grafana.address },
      { ...recordedRange("usage"), split: "model", projectNames: undefined },
    );

    expect(answer.kind).toBe("unreachable");
    expect(answer.kind === "unreachable" && answer.problem).toMatch(/^bad_data: .*parse error/);
  });
});
