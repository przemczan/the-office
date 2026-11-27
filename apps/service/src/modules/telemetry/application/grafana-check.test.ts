import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closedPort, FakeGrafana } from "../adapters/grafana/fake-grafana.fixtures.js";
import { GrafanaStatsSource } from "../adapters/grafana/grafana-stats-source.js";
import { GrafanaInUse, type GrafanaNow } from "../ports/grafana-in-use.js";
import { GrafanaCheck } from "./grafana-check.js";

class SavedTokenForTests extends GrafanaInUse {
  constructor(
    private readonly token: string | undefined,
    private readonly address: string | undefined,
  ) {
    super();
  }
  now(): Promise<GrafanaNow> {
    return Promise.resolve({ kind: "none" });
  }
  savedReadToken(): Promise<string | undefined> {
    return Promise.resolve(this.token);
  }
  savedReadAddress(): Promise<string | undefined> {
    return Promise.resolve(this.address);
  }
}

function checkWith(savedToken?: string, savedAddress?: string): GrafanaCheck {
  return new GrafanaCheck(
    new GrafanaStatsSource(),
    new SavedTokenForTests(savedToken, savedAddress),
  );
}

describe("GrafanaCheck", () => {
  let grafana: FakeGrafana;

  beforeEach(async () => {
    grafana = await FakeGrafana.start();
  });

  afterEach(async () => {
    await grafana.stop();
  });

  it("answers reachable, naming its Prometheus and Loki, with the token as Bearer", async () => {
    const answer = await checkWith().check(grafana.address, "glsa_read");

    expect(answer).toEqual({ state: "reachable", prometheus: "Prometheus", loki: "Loki" });
    expect(grafana.requests[0]?.headers.authorization).toBe("Bearer glsa_read");
  });

  it("checks with the saved read token when none is given, asking afresh each time", async () => {
    const check = checkWith("glsa_saved");

    await check.check(grafana.address, undefined);
    await check.check(grafana.address, "");

    expect(grafana.requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer glsa_saved",
      "Bearer glsa_saved",
    ]);
  });

  it("sends a person's check the saved read token at the saved read address only", async () => {
    const check = checkWith("glsa_saved", `${grafana.address}/`);

    await check.checkAsPerson(grafana.address);

    expect(grafana.requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer glsa_saved",
    ]);
  });

  it("never sends a person's check to another address with the saved read token", async () => {
    const other = await FakeGrafana.start();
    try {
      await checkWith("glsa_saved", grafana.address).checkAsPerson(other.address);

      expect(other.requests.length).toBeGreaterThan(0);
      expect(other.requests.map((request) => request.headers.authorization)).toEqual(
        other.requests.map(() => undefined),
      );
    } finally {
      await other.stop();
    }
  });

  it("finds the data sources a Viewer token may query", async () => {
    grafana.answers.set("/api/datasources", { range: null, status: 403, body: { message: "No" } });
    grafana.answers.set("/api/frontend/settings", {
      range: null,
      status: 200,
      body: {
        datasources: {
          Metrics: { uid: "abc123", type: "prometheus" },
          Logs: { uid: "def456", type: "loki" },
        },
      },
    });

    expect(await checkWith().check(grafana.address, "viewer")).toEqual({
      state: "reachable",
      prometheus: "Metrics",
      loki: "Logs",
    });
  });

  it("answers rejected when Grafana refuses the read token (401)", async () => {
    grafana.answers.set("/api/datasources", {
      range: null,
      status: 401,
      body: { message: "Invalid API key" },
    });

    expect(await checkWith().check(grafana.address, "wrong")).toEqual({ state: "rejected" });
  });

  it("answers rejected when the token may read neither listing (403)", async () => {
    const refused = { range: null, status: 403, body: { message: "Permission denied" } } as const;
    grafana.answers.set("/api/datasources", refused);
    grafana.answers.set("/api/frontend/settings", refused);

    expect(await checkWith().check(grafana.address, "no-role")).toEqual({ state: "rejected" });
  });

  it("answers unreachable, naming the address, when nothing answers there", async () => {
    const address = `http://127.0.0.1:${await closedPort()}`;

    expect(await checkWith().check(address, "glsa_read")).toEqual({
      state: "unreachable",
      problem: `Nothing answers at ${address}.`,
    });
  });

  it("answers unreachable when the address answers, but not as Grafana does", async () => {
    grafana.answers.set("/api/datasources", { range: null, status: 200, body: { hello: "world" } });

    expect(await checkWith().check(grafana.address, undefined)).toEqual({
      state: "unreachable",
      problem: "The answer isn't Grafana's.",
    });
  });

  it("answers no-data-sources naming the ones missing", async () => {
    grafana.answers.set("/api/datasources", {
      range: null,
      status: 200,
      body: [{ uid: "tempo", type: "tempo", name: "Tempo" }],
    });

    expect(await checkWith().check(grafana.address, undefined)).toEqual({
      state: "no-data-sources",
      missing: ["prometheus", "loki"],
    });
  });
});
