import { z } from "zod";
import type { StatsSourceAnswer } from "../../ports/stats-source.js";
import type { GrafanaHttpAnswer } from "./grafana-http.js";

/**
 * A data frame as Grafana answers it: columns (`schema.fields`) and their values (`data.values`,
 * one array per field). A Prometheus range answer, and a Loki metric answer, holds one frame per
 * series: a `time` field (milliseconds) and a `number` field carrying the series' labels. Values
 * Grafana can't put in JSON (NaN) come as null.
 */
const fieldSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  labels: z.record(z.string(), z.string()).nullish(),
});

const frameSchema = z.object({
  schema: z.object({ fields: z.array(fieldSchema).optional() }).optional(),
  data: z.object({ values: z.array(z.array(z.unknown()).nullable()).optional() }).optional(),
});

const resultSchema = z.object({
  status: z.number().optional(),
  error: z.string().optional(),
  frames: z.array(frameSchema).nullish(),
});

/** The answer of `POST /api/ds/query`: each query's result by its refId. */
export const dsQueryAnswerSchema = z.object({ results: z.record(z.string(), resultSchema) });

/** Grafana's answer to a refused or failed API call. */
const messageSchema = z.object({ message: z.string() });

export interface FramePoint {
  readonly atMs: number;
  readonly value: number;
}

/** One series of a result: its labels (an empty label is absent) and its points in time order. */
export interface FrameSeries {
  readonly labels: Readonly<Record<string, string>>;
  readonly points: readonly FramePoint[];
}

/** Each query's series by its refId; a refId Grafana left out has none. */
export type QueryResults = ReadonlyMap<string, readonly FrameSeries[]>;

export const NOT_GRAFANA = "The answer isn't Grafana's.";

/**
 * What an answer of `POST /api/ds/query` comes to: no answer and 401 or 403 as such; a data
 * source's error, which Grafana gives in its result with status 400 (or 207), unreachable with
 * Grafana's own words; any other refusal with Grafana's `message`; else each result's series.
 */
export function resultsOf(answer: GrafanaHttpAnswer): StatsSourceAnswer<QueryResults> {
  if (answer.kind === "failed") return { kind: "unreachable", problem: answer.problem };
  if (answer.status === 401 || answer.status === 403) return { kind: "rejected" };
  const parsed = dsQueryAnswerSchema.safeParse(answer.body);
  if (parsed.success) {
    const failed = Object.values(parsed.data.results).find((result) => result.error);
    if (failed?.error) return { kind: "unreachable", problem: failed.error };
    if (answer.status < 300) {
      const results = new Map<string, readonly FrameSeries[]>();
      for (const [refId, result] of Object.entries(parsed.data.results)) {
        results.set(refId, (result.frames ?? []).flatMap(seriesOf));
      }
      return { kind: "read", value: results };
    }
  }
  return answer.status < 300
    ? { kind: "unreachable", problem: NOT_GRAFANA }
    : { kind: "unreachable", problem: refusalWords(answer) };
}

/** Why Grafana refused a call, from its `message`, else by the status alone. */
export function refusalWords(answer: { readonly status: number; readonly body: unknown }): string {
  const message = messageSchema.safeParse(answer.body);
  return message.success ? message.data.message : `Grafana answered with status ${answer.status}.`;
}

/** A frame's series: one per number field, each over the frame's time field. */
function seriesOf(frame: z.infer<typeof frameSchema>): FrameSeries[] {
  const fields = frame.schema?.fields ?? [];
  const values = frame.data?.values ?? [];
  const timeIndex = fields.findIndex((field) => field.type === "time");
  if (timeIndex < 0) return [];
  const times = values[timeIndex] ?? [];
  return fields.flatMap((field, index) => {
    if (field.type !== "number") return [];
    const column = values[index] ?? [];
    const points: FramePoint[] = [];
    times.forEach((time, row) => {
      const value = column[row];
      if (typeof time === "number" && typeof value === "number" && Number.isFinite(value)) {
        points.push({ atMs: time, value });
      }
    });
    return [{ labels: withoutEmpty(field.labels ?? {}), points }];
  });
}

function withoutEmpty(labels: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(labels).filter(([, value]) => value !== ""));
}

/** A label of the series, "" where it is absent, as Prometheus and Loki drop empty labels. */
export function labelOf(series: FrameSeries, label: string): string {
  return series.labels[label] ?? "";
}

/** A series' last value, an instant query's one value; 0 without any. */
export function lastValueOf(series: FrameSeries): number {
  return series.points.at(-1)?.value ?? 0;
}
