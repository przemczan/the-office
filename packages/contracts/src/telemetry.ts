import { z } from "zod";

/** A header the user's own endpoint is sent, such as an API key: its value is never sent back. */
export const telemetryHeaderSchema = z.object({ name: z.string(), value: z.string() });
export type TelemetryHeader = z.infer<typeof telemetryHeaderSchema>;

/**
 * `PUT /settings/telemetry`: where The Office exports its traces, metrics and logs from its next
 * start. Off; the bundled Grafana's OTLP endpoint; or the user's own OTLP over HTTP endpoint, with
 * `headers` left out to keep the saved ones (a header sent with an empty value keeps the saved value
 * of the header of that name), and an export timeout in milliseconds.
 */
export const telemetryChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("bundled-grafana") }),
  z.object({
    kind: z.literal("own-endpoint"),
    endpoint: z.string(),
    headers: z.array(telemetryHeaderSchema).optional(),
    timeoutMilliseconds: z.number().int().positive().optional(),
  }),
]);
export type TelemetryChoice = z.infer<typeof telemetryChoiceSchema>;

/** The saved choice as the browser sees it: the own endpoint's headers by name alone. */
export const savedTelemetryChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("bundled-grafana") }),
  z.object({
    kind: z.literal("own-endpoint"),
    endpoint: z.string(),
    headerNames: z.array(z.string()),
    timeoutMilliseconds: z.number().int().positive().optional(),
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
 * `GET` and `PUT /settings/telemetry` (Settings › Telemetry): the saved choice, what runs now,
 * whether OTEL_* variables in the environment set telemetry instead (the card is then read-only),
 * and whether the saved choice differs from what runs, applying the next time The Office starts.
 */
export const telemetrySettingsSchema = z.object({
  saved: savedTelemetryChoiceSchema,
  running: runningTelemetrySchema,
  setByEnvironment: z.boolean(),
  appliesAtNextStart: z.boolean(),
});
export type TelemetrySettings = z.infer<typeof telemetrySettingsSchema>;

/** The bundled Grafana's OTLP over HTTP endpoint, on this machine. */
export const BUNDLED_GRAFANA_ENDPOINT = "http://127.0.0.1:4318";
