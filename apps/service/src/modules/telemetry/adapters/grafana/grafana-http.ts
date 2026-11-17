import type { GrafanaAccess } from "../../ports/stats-source.js";

/** A query that takes longer counts as unreachable (spec 5.2). */
export const GRAFANA_TIMEOUT_MS = 10_000;

/**
 * What a call to Grafana came to: an answer with its status and its body read as JSON (undefined
 * when it isn't JSON), or no answer, with why in plain words.
 */
export type GrafanaHttpAnswer =
  | { readonly kind: "answered"; readonly status: number; readonly body: unknown }
  | { readonly kind: "failed"; readonly problem: string };

/**
 * Calls Grafana's HTTP API at `path` under the address, with the read token as Bearer when one is
 * given and none otherwise (the bundled Grafana takes anonymous reads). The timeout covers reading
 * the answer too.
 */
export async function callGrafana(
  access: GrafanaAccess,
  path: string,
  timeoutMs: number,
  body?: unknown,
): Promise<GrafanaHttpAnswer> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (access.token !== undefined && access.token !== "") {
    headers.Authorization = `Bearer ${access.token}`;
  }
  try {
    const response = await fetch(`${access.address.replace(/\/+$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return { kind: "answered", status: response.status, body: jsonOf(text) };
  } catch (error) {
    return { kind: "failed", problem: unansweredWords(error, access.address, timeoutMs) };
  }
}

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Why a call got no answer, in plain words; Node's own message is only "fetch failed". */
export function unansweredWords(error: unknown, address: string, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `No answer within ${timeoutMs / 1000} seconds.`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const code = codeOf(cause) ?? codeOf(error);
  switch (code) {
    case "ECONNREFUSED":
      return `Nothing answers at ${address}.`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `No host is known by the name ${hostOf(address)}.`;
    case "ECONNRESET":
    case "UND_ERR_SOCKET":
      return "The connection closed before Grafana answered.";
    case "ERR_INVALID_URL":
      return `${address} isn't a web address.`;
  }
  if (cause instanceof Error) return cause.message;
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function hostOf(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    return address;
  }
}
