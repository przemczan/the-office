import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeGrafana } from "./fake-grafana.fixtures.js";
import { recorded, recordedRange } from "./grafana-scenario.fixtures.js";
import { GrafanaStatsSource } from "./grafana-stats-source.js";

/** The recordings' range: an hour by 5 min, The Office sending from 10:20. */
const RANGE = recordedRange("system-health-responsiveness");

function valueOf<T>(answer: { kind: string; value?: T }): T {
  if (answer.kind !== "read" || answer.value === undefined)
    throw new Error(`Not read: ${answer.kind}`);
  return answer.value;
}

describe("GrafanaStatsSource, System health", () => {
  let grafana: FakeGrafana;
  let source: GrafanaStatsSource;

  beforeEach(async () => {
    grafana = await FakeGrafana.start();
    source = new GrafanaStatsSource();
  });

  afterEach(async () => {
    await grafana.stop();
  });

  it("reads each block by a request of its own, in the step asked, with PromQL over the measurements", async () => {
    await source.systemHealth({ address: grafana.address }, RANGE);

    expect(grafana.requests.map((request) => request.path)).toEqual([
      "/api/datasources",
      "/api/ds/query",
      "/api/ds/query",
      "/api/ds/query",
      "/api/ds/query",
    ]);
    const bodies = grafana.queries();
    for (const body of bodies) {
      expect(body).toMatchObject({
        from: String(RANGE.from.getTime()),
        to: String(RANGE.to.getTime()),
      });
    }
    const queries = Object.fromEntries(
      bodies.flatMap((body) => body.queries).map((query) => [query.refId, query]),
    );
    expect(queries.lagP99).toMatchObject({
      datasource: { type: "prometheus", uid: "prometheus" },
      expr: "max(max_over_time(nodejs_eventloop_delay_p99_seconds[300s])) * 1000",
      range: true,
      interval: "300s",
      utcOffsetSec: 0,
    });
    expect(queries.lagMax?.expr).toBe(
      "max(max_over_time(nodejs_eventloop_delay_max_seconds[300s])) * 1000",
    );
    expect(queries.officeCpu?.expr).toBe(
      "avg(avg_over_time(process_cpu_utilization_ratio[300s])) * avg(avg_over_time(system_cpu_logical_count[300s])) * 100",
    );
    expect(queries.officeCpuOfWorkstation?.expr).toBe(
      "avg(avg_over_time(process_cpu_utilization_ratio[300s])) * 100",
    );
    expect(queries.memory?.expr).toBe("avg(avg_over_time(process_memory_usage_bytes[300s]))");
    expect(queries.heap?.expr).toBe("avg(avg_over_time(v8js_memory_heap_used_bytes[300s]))");
    expect(queries.systemCpu?.expr).toBe(
      "avg(avg_over_time(system_cpu_utilization_ratio[300s])) * 100",
    );
    expect(queries.systemMemory?.expr).toBe(
      "avg(avg_over_time(system_memory_utilization_ratio[300s])) * 100",
    );
    expect(queries.requestsPerMinute?.expr).toBe(
      "sum(increase(http_server_request_duration_seconds_count[300s])) * 60 / 300",
    );
    expect(queries.requestP95?.expr).toBe(
      "histogram_quantile(0.95, sum by (le) (increase(http_server_request_duration_seconds_bucket[300s]))) * 1000",
    );
    expect(queries.requestsTotal).toMatchObject({
      expr: "sum(increase(http_server_request_duration_seconds_count[3600s]))",
      instant: true,
      range: false,
    });
    expect(queries.routeP95?.expr).toBe(
      "histogram_quantile(0.95, sum by (le, http_route, http_request_method) (increase(http_server_request_duration_seconds_bucket[3600s]))) * 1000",
    );
    expect(queries.routeMax?.expr).toBe(
      "histogram_quantile(1, sum by (le, http_route, http_request_method) (increase(http_server_request_duration_seconds_bucket[3600s]))) * 1000",
    );
    expect(queries.routeTotal?.expr).toBe(
      "sum by (http_route, http_request_method) (increase(http_server_request_duration_seconds_sum[3600s])) * 1000",
    );
    expect(queries.waiting?.expr).toBe(
      'max(max_over_time(db_client_connection_pending_requests{db_client_connection_pool_name=""}[300s]))',
    );
    expect(queries.queryP95?.expr).toBe(
      "histogram_quantile(0.95, sum by (le) (increase(office_db_query_duration_seconds_bucket[300s]))) * 1000",
    );
    expect(queries.tableCount?.expr).toBe(
      "sum by (db_operation_name, db_collection_name) (increase(office_db_query_duration_seconds_count[3600s]))",
    );
  });

  it("answers each block's series at its steps' starts, its totals and slowest rows", async () => {
    const read = await source.systemHealth({ address: grafana.address }, RANGE);

    const responsiveness = valueOf(read.responsiveness);
    expect(responsiveness.lagP99Ms.map(({ at }) => at.toISOString())).toEqual([
      "2026-11-17T10:20:00.000Z",
      "2026-11-17T10:25:00.000Z",
      "2026-11-17T10:30:00.000Z",
      "2026-11-17T10:35:00.000Z",
      "2026-11-17T10:40:00.000Z",
      "2026-11-17T10:45:00.000Z",
      "2026-11-17T10:50:00.000Z",
      "2026-11-17T10:55:00.000Z",
    ]);
    expect(Math.max(...responsiveness.lagMaxMs.map(({ value }) => value))).toBe(842);
    expect(valueOf(read["cpu-and-memory"]).officeCpuPercent[3]?.value).toBe(96.2);

    const requests = valueOf(read.requests);
    // A step with no request has no p95 (NaN, null in Grafana's answer): left out.
    expect(requests.p95Ms).toHaveLength(7);
    expect(requests).toMatchObject({ total: 12301.4, totalP95Ms: 46.8 });
    // A route with nothing in the range is left out; no route is "Unmatched".
    expect(requests.slowest).toEqual(
      expect.arrayContaining([
        {
          route: { method: "GET", template: "/api/tasks/:id/stage-runs" },
          count: 4021.6,
          p95Ms: 237.5,
          maxMs: 1000,
          totalMs: 251032.4,
        },
        { route: null, count: 177.5, p95Ms: 4.75, maxMs: 10, totalMs: 412.9 },
      ]),
    );
    expect(requests.slowest).toHaveLength(3);

    const database = valueOf(read.database);
    expect(Math.max(...database.connectionsWaiting.map(({ value }) => value))).toBe(7);
    expect(database.slowest).toContainEqual({
      operation: "BEGIN",
      table: "",
      count: 3000.2,
      p95Ms: 0.475,
      maxMs: 1,
      totalMs: 600.4,
    });
  });

  it("answers a block whose query fails on its own, the others read", async () => {
    grafana.queryAnswers.set("requestsPerMinute", recorded("data-source-error"));
    grafana.queryAnswers.set("queriesPerMinute", {
      range: null,
      status: 401,
      body: { message: "Invalid API key" },
    });

    const read = await source.systemHealth({ address: grafana.address }, RANGE);

    expect(read.responsiveness.kind).toBe("read");
    expect(read["cpu-and-memory"].kind).toBe("read");
    expect(read.requests).toMatchObject({ kind: "unreachable" });
    expect(read.database).toEqual({ kind: "rejected" });
  });

  it("answers every block as the data sources' listing failed", async () => {
    grafana.answers.set("/api/datasources", { range: null, status: 401, body: {} });

    const read = await source.systemHealth({ address: grafana.address, token: "wrong" }, RANGE);

    expect(read).toEqual({
      responsiveness: { kind: "rejected" },
      "cpu-and-memory": { kind: "rejected" },
      requests: { kind: "rejected" },
      database: { kind: "rejected" },
    });
    expect(grafana.queries()).toEqual([]);
  });
});
