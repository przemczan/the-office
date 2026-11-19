import type { GrafanaInUse } from "../ports/grafana-in-use.js";
import type { GrafanaAccess, StatsSourceAnswer } from "../ports/stats-source.js";

/**
 * The Grafana states (spec 2.11, States) in which nothing was read: none chosen, the bundled one
 * starting or failed to start, or the Grafana in use unreachable, refusing the read token or
 * holding nothing The Office sent.
 */
export type GrafanaUnread =
  | { readonly state: "not-on" }
  | { readonly state: "starting"; readonly address: string }
  | { readonly state: "failed"; readonly address: string; readonly problem: string }
  | { readonly state: "unreachable"; readonly address: string; readonly problem: string }
  | { readonly state: "rejected"; readonly address: string }
  | { readonly state: "no-data"; readonly address: string };

/**
 * Reads through the Grafana in use now, Settings › Telemetry read afresh: `read` once one is
 * ready, else the state that keeps it from being read.
 */
export async function readFromGrafana<T>(
  grafana: GrafanaInUse,
  read: (access: GrafanaAccess) => Promise<T>,
): Promise<T | GrafanaUnread> {
  const now = await grafana.now();
  switch (now.kind) {
    case "none":
      return { state: "not-on" };
    case "starting":
      return { state: "starting", address: now.address };
    case "failed":
      return { state: "failed", address: now.address, problem: now.problem };
    case "ready":
      return read(now.access);
  }
}

export function answered<T>(value: T): Promise<StatsSourceAnswer<T>> {
  return Promise.resolve({ kind: "read", value });
}

export function isRead<T>(
  answer: StatsSourceAnswer<T>,
): answer is { readonly kind: "read"; readonly value: T } {
  return answer.kind === "read";
}

/**
 * The state of the first answer that wasn't read, in the order given: Grafana unreachable, or the
 * token rejected.
 */
export function failedRead(
  address: string,
  answers: readonly StatsSourceAnswer<unknown>[],
): Extract<GrafanaUnread, { readonly state: "unreachable" | "rejected" }> {
  const failed = answers.find((answer) => answer.kind !== "read");
  if (failed?.kind === "unreachable") {
    return { state: "unreachable", address, problem: failed.problem };
  }
  return { state: "rejected", address };
}
