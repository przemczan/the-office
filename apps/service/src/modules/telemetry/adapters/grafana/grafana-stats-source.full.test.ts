import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeGrafana } from "./fake-grafana.fixtures.js";
import { recordedRange, SCENARIO } from "./grafana-scenario.fixtures.js";
import { GrafanaStatsSource } from "./grafana-stats-source.js";

describe("GrafanaStatsSource, beyond the main reads", () => {
  let grafana: FakeGrafana;

  beforeEach(async () => {
    grafana = await FakeGrafana.start();
  });

  afterEach(async () => {
    await grafana.stop();
  });

  it("counts a query with no answer in time as unreachable", async () => {
    grafana.answers.set("/api/ds/query", "never");

    const answer = await GrafanaStatsSource.withTimeout(200).windows(
      { address: grafana.address },
      recordedRange("windows"),
    );

    expect(answer).toEqual({ kind: "unreachable", problem: "No answer within 0.2 seconds." });
  });

  it("answers unreachable when the answer isn't Grafana's", async () => {
    grafana.answers.set("/api/ds/query", { range: null, status: 200, body: { hello: "world" } });

    const answer = await new GrafanaStatsSource().windows(
      { address: grafana.address },
      recordedRange("windows"),
    );

    expect(answer).toEqual({ kind: "unreachable", problem: "The answer isn't Grafana's." });
  });

  it("answers unreachable with Grafana's message when it fails a query", async () => {
    grafana.answers.set("/api/ds/query", {
      range: null,
      status: 500,
      body: { message: "Query data error" },
    });

    const answer = await new GrafanaStatsSource().windows(
      { address: grafana.address },
      recordedRange("windows"),
    );

    expect(answer).toEqual({ kind: "unreachable", problem: "Query data error" });
  });

  it("finds the data sources a Viewer token may query when it may not list them", async () => {
    grafana.answers.set("/api/datasources", {
      range: null,
      status: 403,
      body: { message: "You'll need additional permissions to perform this action." },
    });
    grafana.answers.set("/api/frontend/settings", {
      range: null,
      status: 200,
      body: {
        datasources: {
          Metrics: { uid: "abc123", type: "prometheus", name: "Metrics" },
          Logs: { uid: "def456", type: "loki", name: "Logs" },
        },
      },
    });
    const source = new GrafanaStatsSource();

    const found = await source.findDataSources({ address: grafana.address, token: "viewer" });
    await source.windows({ address: grafana.address, token: "viewer" }, recordedRange("windows"));

    expect(found).toEqual({
      kind: "read",
      value: {
        prometheus: { type: "prometheus", uid: "abc123", name: "Metrics" },
        loki: { type: "loki", uid: "def456", name: "Logs" },
      },
    });
    expect(grafana.queries()[0]?.queries[0]?.datasource).toEqual({
      type: "prometheus",
      uid: "abc123",
    });
  });

  it("falls back to otel-lgtm's uids when Grafana lists no data source", async () => {
    grafana.answers.set("/api/datasources", { range: null, status: 200, body: [] });
    grafana.answers.set("/api/frontend/settings", { range: null, status: 404, body: {} });

    await new GrafanaStatsSource().windows({ address: grafana.address }, recordedRange("windows"));

    expect(grafana.queries()[0]?.queries[0]?.datasource).toEqual({
      type: "prometheus",
      uid: "prometheus",
    });
  });

  it("lists the data sources once per address", async () => {
    const source = new GrafanaStatsSource();
    const range = recordedRange("windows");

    await source.windows({ address: grafana.address }, range);
    await source.windows({ address: grafana.address }, range);

    expect(grafana.requests.map((request) => request.path)).toEqual([
      "/api/datasources",
      "/api/ds/query",
      "/api/ds/query",
    ]);
  });

  it("skips the breakdown when no Task nor Initiative had a cost", async () => {
    grafana.answers.set("/api/ds/query", {
      range: null,
      status: 200,
      body: { results: { topTasks: { frames: [] }, topInitiatives: { frames: [] } } },
    });
    const range = recordedRange("costliest-top");

    const answer = await new GrafanaStatsSource().costliest(
      { address: grafana.address },
      { from: range.from, to: range.to, limit: 10, projectNames: undefined },
    );

    expect(answer).toEqual({ kind: "read", value: { tasks: [], initiatives: [] } });
    expect(grafana.queries()).toHaveLength(1);
  });

  it("keeps the Initiatives with a call in the Projects named, totalled whole", async () => {
    const range = recordedRange("costliest-top");

    await new GrafanaStatsSource().costliest(
      { address: grafana.address },
      { from: range.from, to: range.to, limit: 10, projectNames: ["Admin panel"] },
    );

    const [top, breakdown] = grafana.queries();
    expect(top?.queries.map((query) => query.expr)).toEqual([
      'topk(10, sum by (office_task) (sum_over_time({service_name="the-office"} |= "office.engine.call" | office_task!="" | office_project=~"Admin panel" | unwrap office_cost_estimated_usd | __error__="" [3600s])))',
      'topk(10, sum by (office_initiative) (sum_over_time({service_name="the-office"} |= "office.engine.call" | office_initiative!="" | unwrap office_cost_estimated_usd | __error__="" [3600s])) and sum by (office_initiative) (count_over_time({service_name="the-office"} |= "office.engine.call" | office_initiative!="" | office_project=~"Admin panel" [3600s])))',
    ]);
    expect(breakdown?.queries.find((query) => query.refId === "initiativeCost")?.expr).toContain(
      `| office_initiative=~"${SCENARIO.initiative}" | unwrap`,
    );
  });
});
