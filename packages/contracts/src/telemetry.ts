import { z } from "zod";

/** A header the user's own endpoint is sent, such as an API key: its value is never sent back. */
export const telemetryHeaderSchema = z.object({ name: z.string(), value: z.string() });
export type TelemetryHeader = z.infer<typeof telemetryHeaderSchema>;

/**
 * Where Stats reads the user's own Grafana: its address and a read token (a Viewer service
 * account's), sent as Bearer. A `readToken` left out or empty keeps the saved one.
 */
export const ownGrafanaSchema = z.object({
  readAddress: z.string(),
  readToken: z.string().optional(),
});
export type OwnGrafana = z.infer<typeof ownGrafanaSchema>;

/** The user's own Grafana as the browser sees it: whether a read token is saved, never the token. */
export const savedOwnGrafanaSchema = z.object({
  readAddress: z.string(),
  hasReadToken: z.boolean(),
});
export type SavedOwnGrafana = z.infer<typeof savedOwnGrafanaSchema>;

/**
 * `PUT /settings/telemetry`: where The Office exports its traces, metrics and logs from its next
 * start. Off; the bundled Grafana's OTLP endpoint; or the user's own OTLP over HTTP endpoint, with
 * `headers` left out to keep the saved ones (a header sent with an empty value keeps the saved value
 * of the header of that name), and an export timeout in milliseconds. Its `grafana` is where Stats
 * reads the full stats, applying at once: left out keeps the saved one, `null` removes it.
 */
export const telemetryChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("bundled-grafana") }),
  z.object({
    kind: z.literal("own-endpoint"),
    endpoint: z.string(),
    headers: z.array(telemetryHeaderSchema).optional(),
    timeoutMilliseconds: z.number().int().positive().optional(),
    grafana: ownGrafanaSchema.nullable().optional(),
  }),
]);
export type TelemetryChoice = z.infer<typeof telemetryChoiceSchema>;

/**
 * The saved choice as the browser sees it: the own endpoint's headers by name alone, and its
 * Grafana with whether a read token is saved.
 */
export const savedTelemetryChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("bundled-grafana") }),
  z.object({
    kind: z.literal("own-endpoint"),
    endpoint: z.string(),
    headerNames: z.array(z.string()),
    timeoutMilliseconds: z.number().int().positive().optional(),
    grafana: savedOwnGrafanaSchema.optional(),
  }),
]);
export type SavedTelemetryChoice = z.infer<typeof savedTelemetryChoiceSchema>;

/** What this run of The Office exports to, read at its start. */
export const runningTelemetrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("exporting"), endpoint: z.string() }),
]);
export type RunningTelemetry = z.infer<typeof runningTelemetrySchema>;

/**
 * The bundled Grafana as The Office keeps it: `not-wanted` unless Bundled Grafana is saved and the
 * environment doesn't set telemetry; else `starting`, `running` or `failed` with the problem in
 * plain words. `earlierStopped` names the earlier bundled Grafana containers The Office stopped
 * before starting its own.
 */
export const bundledGrafanaStatusSchema = z.object({
  state: z.enum(["not-wanted", "starting", "running", "failed"]),
  problem: z.string().optional(),
  address: z.string(),
  earlierStopped: z.array(z.string()),
});
export type BundledGrafanaStatus = z.infer<typeof bundledGrafanaStatusSchema>;

/**
 * `GET` and `PUT /settings/telemetry` (Settings › Telemetry), and `POST
 * /settings/telemetry/bundled-grafana/start` (Try again): the saved choice, what runs now, whether
 * OTEL_* variables in the environment set telemetry instead (the card is then read-only), whether
 * the saved choice differs from what runs, applying the next time The Office starts, and the
 * bundled Grafana's state.
 */
export const telemetrySettingsSchema = z.object({
  saved: savedTelemetryChoiceSchema,
  running: runningTelemetrySchema,
  setByEnvironment: z.boolean(),
  appliesAtNextStart: z.boolean(),
  bundledGrafana: bundledGrafanaStatusSchema,
});
export type TelemetrySettings = z.infer<typeof telemetrySettingsSchema>;

/** The bundled Grafana's OTLP over HTTP endpoint, on this machine. */
export const BUNDLED_GRAFANA_ENDPOINT = "http://127.0.0.1:4318";

/** Where a person opens the bundled Grafana, on the machine The Office runs on. */
export const BUNDLED_GRAFANA_ADDRESS = "http://localhost:3300";
