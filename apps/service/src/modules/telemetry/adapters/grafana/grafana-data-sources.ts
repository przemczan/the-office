import { z } from "zod";
import type { GrafanaAccess, StatsSourceAnswer } from "../../ports/stats-source.js";
import { callGrafana, type GrafanaHttpAnswer } from "./grafana-http.js";
import {
  DEFAULT_LOKI_UID,
  DEFAULT_PROMETHEUS_UID,
  LOKI_TYPE,
  PROMETHEUS_TYPE,
  type DataSourceRef,
} from "./grafana-queries.js";

/** The data sources the full stats query: metrics from Prometheus, records from Loki. */
export interface GrafanaDataSources {
  readonly prometheus: NamedDataSource;
  readonly loki: NamedDataSource;
}

/** A data source as the queries name it, with its name in Grafana; undefined for a fallback uid. */
export interface NamedDataSource extends DataSourceRef {
  readonly name: string | undefined;
}

interface ListedDataSource {
  readonly uid: string;
  readonly type: string;
  readonly name: string | undefined;
  readonly isDefault: boolean;
}

const listSchema = z.array(
  z.object({
    uid: z.string(),
    type: z.string(),
    name: z.string().optional(),
    isDefault: z.boolean().optional(),
  }),
);

const frontendSettingsSchema = z.object({
  datasources: z.record(
    z.string(),
    z.object({
      uid: z.string().optional(),
      type: z.string(),
      name: z.string().optional(),
      isDefault: z.boolean().optional(),
    }),
  ),
});

/**
 * Finds the Prometheus and Loki data sources of a Grafana by their type, kept per address and
 * token once both are found by name, so each read costs one call.
 *
 * `GET /api/datasources` lists them for an Admin, which the bundled Grafana's anonymous user is;
 * a Viewer service account token, which Settings › Telemetry asks for, is refused it (403), so
 * then `GET /api/frontend/settings` gives the ones the token may query. A 401 there is the token
 * refused, and no answer at all is Grafana unreachable: either is answered as it is. Any other
 * failure, or a Grafana listing neither, falls back to otel-lgtm's provisioned uids, uncached: a
 * query on a wrong uid then answers Grafana's own error, which says more than a guess here would.
 */
export class GrafanaDataSourceCache {
  private readonly found = new Map<string, GrafanaDataSources>();

  async of(
    access: GrafanaAccess,
    timeoutMs: number,
  ): Promise<StatsSourceAnswer<GrafanaDataSources>> {
    const key = keyOf(access);
    const cached = this.found.get(key);
    if (cached) return { kind: "read", value: cached };
    let listed: readonly ListedDataSource[] = [];
    for (const [path, read] of LISTINGS) {
      const answer = await callGrafana(access, path, timeoutMs);
      if (answer.kind === "failed") return { kind: "unreachable", problem: answer.problem };
      if (answer.status === 401) return { kind: "rejected" };
      listed = read(answer);
      if (listed.length > 0) break;
    }
    const prometheus = pick(listed, PROMETHEUS_TYPE, DEFAULT_PROMETHEUS_UID);
    const loki = pick(listed, LOKI_TYPE, DEFAULT_LOKI_UID);
    const sources = { prometheus, loki };
    if (prometheus.name !== undefined && loki.name !== undefined) this.found.set(key, sources);
    return { kind: "read", value: sources };
  }

  /** Forgets what was found, after a read through them failed: they may have changed. */
  forget(access: GrafanaAccess): void {
    this.found.delete(keyOf(access));
  }
}

const LISTINGS: readonly (readonly [string, (answer: GrafanaHttpAnswer) => ListedDataSource[]])[] =
  [
    ["/api/datasources", (answer) => listedOf(answer)],
    ["/api/frontend/settings", (answer) => frontendListedOf(answer)],
  ];

function listedOf(answer: GrafanaHttpAnswer): ListedDataSource[] {
  if (answer.kind !== "answered" || answer.status >= 300) return [];
  const parsed = listSchema.safeParse(answer.body);
  return parsed.success
    ? parsed.data.map((source) => ({
        uid: source.uid,
        type: source.type,
        name: source.name ?? source.uid,
        isDefault: source.isDefault ?? false,
      }))
    : [];
}

function frontendListedOf(answer: GrafanaHttpAnswer): ListedDataSource[] {
  if (answer.kind !== "answered" || answer.status >= 300) return [];
  const parsed = frontendSettingsSchema.safeParse(answer.body);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.datasources).flatMap(([name, source]) =>
    source.uid === undefined
      ? []
      : [
          {
            uid: source.uid,
            type: source.type,
            name: source.name ?? name,
            isDefault: source.isDefault ?? false,
          },
        ],
  );
}

/**
 * The data source of the type: the one at otel-lgtm's uid, else Grafana's default, else the first
 * listed; the provisioned uid, unnamed, when none is listed.
 */
function pick(listed: readonly ListedDataSource[], type: string, uid: string): NamedDataSource {
  const ofType = listed.filter((source) => source.type === type);
  const chosen =
    ofType.find((source) => source.uid === uid) ??
    ofType.find((source) => source.isDefault) ??
    ofType[0];
  return chosen ? { type, uid: chosen.uid, name: chosen.name } : { type, uid, name: undefined };
}

function keyOf(access: GrafanaAccess): string {
  return `${access.address.replace(/\/+$/, "")}\n${access.token ?? ""}`;
}
