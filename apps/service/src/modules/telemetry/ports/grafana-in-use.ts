import type { GrafanaAccess } from "./stats-source.js";

/**
 * The Grafana Stats reads now: `none` unless one is chosen and telemetry isn't set by the
 * environment; the bundled one while it starts or after it couldn't; `ready` once it can be read,
 * as the bundled one runs or the user's own is saved.
 */
export type GrafanaNow =
  | { readonly kind: "none" }
  | { readonly kind: "starting"; readonly address: string }
  | { readonly kind: "failed"; readonly address: string; readonly problem: string }
  | { readonly kind: "ready"; readonly access: GrafanaAccess };

/** Which Grafana the full stats are read from, by Settings › Telemetry; an adapter binds it. */
export abstract class GrafanaInUse {
  abstract now(): Promise<GrafanaNow>;

  /** The read token saved for the user's own Grafana, for a check that leaves it out. */
  abstract savedReadToken(): Promise<string | undefined>;

  /** The read address saved for the user's own Grafana, which the saved read token belongs to. */
  abstract savedReadAddress(): Promise<string | undefined>;
}
