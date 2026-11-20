import { z } from "zod";
import type {
  DataSourcesFound,
  GrafanaAccess,
  StatsSourceAnswer,
} from "../../ports/stats-source.js";
import { NOT_GRAFANA } from "./grafana-frames.js";
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
 * then `GET /api/frontend/settings` gives the ones the token may query. A 401, or a 403 there, is
 * the token refused, and no answer at all is Grafana unreachable: either is answered as it is. Any other
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
    const listing = await listDataSources(access, timeoutMs);
    if (listing.kind !== "read") return listing;
    const { listed } = listing.value;
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

/**
 * Which data sources of the full stats a Grafana has, asked afresh, without the fallback uids:
 * unreachable too when no listing answers as Grafana does, as a wrong address may answer.
 */
export async function checkDataSources(
  access: GrafanaAccess,
  timeoutMs: number,
): Promise<StatsSourceAnswer<DataSourcesFound>> {
  const listing = await listDataSources(access, timeoutMs);
  if (listing.kind !== "read") return listing;
  const { listed, isGrafana } = listing.value;
  if (!isGrafana) return { kind: "unreachable", problem: NOT_GRAFANA };
  return {
    kind: "read",
    value: {
      prometheus: pick(listed, PROMETHEUS_TYPE, DEFAULT_PROMETHEUS_UID).name,
      loki: pick(listed, LOKI_TYPE, DEFAULT_LOKI_UID).name,
    },
  };
}

/** What a Grafana lists, and whether any listing answered as Grafana does, even listing none. */
interface DataSourceListing {
  readonly listed: readonly ListedDataSource[];
  readonly isGrafana: boolean;
}

/**
 * Lists the data sources, by the first listing that names any: a listing's refusal is the token
 * refused and no answer at all is Grafana unreachable.
 */
async function listDataSources(
  access: GrafanaAccess,
  timeoutMs: number,
): Promise<StatsSourceAnswer<DataSourceListing>> {
  let isGrafana = false;
  for (const { path, refusals, read } of LISTINGS) {
    const answer = await callGrafana(access, path, timeoutMs);
    if (answer.kind === "failed") return { kind: "unreachable", problem: answer.problem };
    if (refusals.includes(answer.status)) return { kind: "rejected" };
    const listed = read(answer);
    if (listed !== undefined) isGrafana = true;
    if (listed !== undefined && listed.length > 0) {
      return { kind: "read", value: { listed, isGrafana } };
    }
  }
  return { kind: "read", value: { listed: [], isGrafana } };
}

interface Listing {
  readonly path: string;
  /** The statuses that mean the token is refused. */
  readonly refusals: readonly number[];
  /** Undefined for an answer that isn't a listing. */
  readonly read: (answer: GrafanaHttpAnswer) => ListedDataSource[] | undefined;
}

// A Viewer token is refused the full list (403) but may read the frontend settings.
const LISTINGS: readonly Listing[] = [
  { path: "/api/datasources", refusals: [401], read: listedOf },
  { path: "/api/frontend/settings", refusals: [401, 403], read: frontendListedOf },
];

function listedOf(answer: GrafanaHttpAnswer): ListedDataSource[] | undefined {
  if (answer.kind !== "answered" || answer.status >= 300) return undefined;
  const parsed = listSchema.safeParse(answer.body);
  return parsed.success
    ? parsed.data.map((source) => ({
        uid: source.uid,
        type: source.type,
        name: source.name ?? source.uid,
        isDefault: source.isDefault ?? false,
      }))
    : undefined;
}

function frontendListedOf(answer: GrafanaHttpAnswer): ListedDataSource[] | undefined {
  if (answer.kind !== "answered" || answer.status >= 300) return undefined;
  const parsed = frontendSettingsSchema.safeParse(answer.body);
  if (!parsed.success) return undefined;
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
