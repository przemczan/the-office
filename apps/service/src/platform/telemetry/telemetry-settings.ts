import {
  BUNDLED_GRAFANA_ENDPOINT,
  type RunningTelemetry,
  type TelemetryChoice,
  type TelemetryHeader,
} from "@the-office/contracts";
import type { EnvironmentVariables } from "../config/office-config.js";
import {
  BUNDLED_EXPORT_TIMEOUT_MILLISECONDS,
  exportTimeoutMilliseconds,
} from "./export-timeout.js";

/** The standard variables that, set in the environment, decide telemetry instead of the setting. */
export const TELEMETRY_VARIABLES = [
  "OTEL_SDK_DISABLED",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
] as const;

/** Where the OTLP exporters send to when the environment names no endpoint (their own default). */
const OTLP_DEFAULT_ENDPOINT = "http://localhost:4318";

/** The OTLP exporters' own default for an endpoint of the user's that names no timeout. */
const OWN_ENDPOINT_DEFAULT_TIMEOUT_MILLISECONDS = 10_000;

/**
 * What telemetry this run of The Office has, decided once at its start: off; exported as the
 * environment's OTEL_* variables say, the SDK reading them itself; or exported to an endpoint the
 * setting names, with its headers and timeout.
 */
export type TelemetryInEffect =
  | { readonly kind: "off"; readonly setByEnvironment: boolean }
  | {
      readonly kind: "environment";
      readonly endpoint: string;
      readonly timeoutMilliseconds: number;
    }
  | {
      readonly kind: "export";
      readonly endpoint: string;
      readonly headers: readonly TelemetryHeader[];
      readonly timeoutMilliseconds: number;
    };

export const TELEMETRY_OFF: TelemetryInEffect = { kind: "off", setByEnvironment: false };

/** Whether the environment sets any of the variables that decide telemetry. */
export function telemetrySetByEnvironment(environment: EnvironmentVariables): boolean {
  return TELEMETRY_VARIABLES.some((name) => Boolean(environment[name]?.trim()));
}

/**
 * What telemetry applies: OTEL_* in the environment win over the saved choice (`file`), as they
 * did before the setting existed (OTEL_SDK_DISABLED=true turns it off); otherwise the saved
 * choice; with neither, off.
 */
export function telemetrySettingsFrom(
  file: TelemetryChoice | undefined,
  environment: EnvironmentVariables,
): TelemetryInEffect {
  if (telemetrySetByEnvironment(environment)) {
    if (environment["OTEL_SDK_DISABLED"]?.trim().toLowerCase() === "true") {
      return { kind: "off", setByEnvironment: true };
    }
    return {
      kind: "environment",
      endpoint: environment["OTEL_EXPORTER_OTLP_ENDPOINT"]?.trim() || OTLP_DEFAULT_ENDPOINT,
      timeoutMilliseconds: exportTimeoutMilliseconds(environment),
    };
  }
  switch (file?.kind) {
    case undefined:
    case "off":
      return TELEMETRY_OFF;
    case "bundled-grafana":
      return {
        kind: "export",
        endpoint: BUNDLED_GRAFANA_ENDPOINT,
        headers: [],
        timeoutMilliseconds: BUNDLED_EXPORT_TIMEOUT_MILLISECONDS,
      };
    case "own-endpoint":
      return {
        kind: "export",
        endpoint: file.endpoint,
        headers: file.headers ?? [],
        timeoutMilliseconds: file.timeoutMilliseconds ?? OWN_ENDPOINT_DEFAULT_TIMEOUT_MILLISECONDS,
      };
  }
}

/** Whether telemetry was set by the environment at this run's start. */
export function isSetByEnvironment(inEffect: TelemetryInEffect): boolean {
  return inEffect.kind === "environment" || (inEffect.kind === "off" && inEffect.setByEnvironment);
}

/** What this run exports to, as the browser sees it: never a header. */
export function runningTelemetryOf(inEffect: TelemetryInEffect): RunningTelemetry {
  return inEffect.kind === "off"
    ? { kind: "off" }
    : { kind: "exporting", endpoint: inEffect.endpoint };
}

/** Whether two settings export alike: the same endpoint, headers and timeout, or both off. */
export function sameTelemetry(one: TelemetryInEffect, other: TelemetryInEffect): boolean {
  if (one.kind === "off" || other.kind === "off") return one.kind === other.kind;
  if (one.kind !== other.kind) return false;
  if (one.endpoint !== other.endpoint || one.timeoutMilliseconds !== other.timeoutMilliseconds) {
    return false;
  }
  if (one.kind === "environment" || other.kind === "environment") return true;
  return (
    one.headers.length === other.headers.length &&
    one.headers.every(
      (header, index) =>
        header.name === other.headers[index]?.name && header.value === other.headers[index]?.value,
    )
  );
}
