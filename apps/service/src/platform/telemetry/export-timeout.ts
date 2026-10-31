import type { EnvironmentVariables } from "../config/office-config.js";

// The bundled otel-lgtm runs on this machine: an export that takes longer has failed, and a
// stopped otel-lgtm must not hold up a start or a shutdown.
const BUNDLED_EXPORT_TIMEOUT_MILLISECONDS = 2_000;

/**
 * How long one export may take: the standard OTEL_EXPORTER_OTLP_TIMEOUT when it holds a positive
 * number of milliseconds, since the user's own collector may be off this machine, else 2 seconds.
 * The exporters and their processors are given it explicitly, which would otherwise override it.
 */
export function exportTimeoutMilliseconds(environment: EnvironmentVariables): number {
  const value = environment["OTEL_EXPORTER_OTLP_TIMEOUT"]?.trim();
  const configured = value ? Number(value) : Number.NaN;
  return Number.isFinite(configured) && configured > 0
    ? configured
    : BUNDLED_EXPORT_TIMEOUT_MILLISECONDS;
}
