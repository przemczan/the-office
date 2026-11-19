import { Injectable } from "@nestjs/common";
import { GrafanaInUse } from "../ports/grafana-in-use.js";
import { StatsSource, type GrafanaAccess } from "../ports/stats-source.js";

/** A data source the full stats read. */
export type GrafanaDataSourceKind = "prometheus" | "loki";

/**
 * What a check of the user's own Grafana found: it answered with both data sources, by their names,
 * refused the read token, can't be reached (why in plain words), or lacks the data sources in
 * `missing`.
 */
export type GrafanaCheckAnswer =
  | { readonly state: "reachable"; readonly prometheus: string; readonly loki: string }
  | { readonly state: "rejected" }
  | { readonly state: "unreachable"; readonly problem: string }
  | { readonly state: "no-data-sources"; readonly missing: readonly GrafanaDataSourceKind[] };

/** Settings › Telemetry's Test: whether Stats could read the user's own Grafana. */
@Injectable()
export class GrafanaCheck {
  constructor(
    private readonly source: StatsSource,
    private readonly inUse: GrafanaInUse,
  ) {}

  /** Checks the Grafana at the address; with no token given, with the saved read token. */
  async check(address: string, token: string | undefined): Promise<GrafanaCheckAnswer> {
    if (!isHttpUrl(address)) {
      return { state: "unreachable", problem: `${address} isn't an http:// or https:// address.` };
    }
    const readToken = token || (await this.inUse.savedReadToken());
    const access: GrafanaAccess = { address, ...(readToken && { token: readToken }) };
    const answer = await this.source.dataSources(access);
    switch (answer.kind) {
      case "rejected":
        return { state: "rejected" };
      case "unreachable":
        return { state: "unreachable", problem: answer.problem };
      case "read": {
        const { prometheus, loki } = answer.value;
        if (prometheus !== undefined && loki !== undefined) {
          return { state: "reachable", prometheus, loki };
        }
        const missing: GrafanaDataSourceKind[] = [];
        if (prometheus === undefined) missing.push("prometheus");
        if (loki === undefined) missing.push("loki");
        return { state: "no-data-sources", missing };
      }
    }
  }
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}
