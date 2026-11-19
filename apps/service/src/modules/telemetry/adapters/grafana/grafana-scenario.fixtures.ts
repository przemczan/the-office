import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * What the recorded answers hold: the engine calls and Usage windows the live check sends through
 * the real Telemetry before it records Grafana's answers, and that the default run reads back from
 * those recordings. Two Tasks, the first in an Initiative with a Stage retried and a call outside a
 * Stage, and the Initiative's own Thread.
 */
export const SCENARIO = {
  engineId: "claude-code",
  firstTask: "5d0e7c3a-1f42-4b8e-9c61-2a7f0b9d4e11",
  secondTask: "8a4b2e6f-93c1-4d7a-b5e0-6c1f3d8a2b22",
  initiative: "c7e1f9a2-4b6d-4e3f-8a1c-9d2b5e7f0a33",
  firstRun: "b1f0c6e2-7a3d-4c58-9e14-3f2a8d6c1e44",
  retry: "e9d3a7b5-2c1f-4e86-a0b4-7d5c9f3e2a55",
  reviewRun: "4c8e2a6d-1b9f-4f73-8e25-0a6d4b9c7f66",
  fiveHourPercent: 42,
  sevenDayPercent: 13,
} as const;

export interface ScenarioCall {
  readonly task: string;
  readonly initiative: string;
  readonly stage: string;
  readonly stageRun: string;
  readonly role: string;
  readonly model: string;
  readonly pipeline: string;
  readonly project: string;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreation: number;
  };
  readonly estimatedUsd: number;
}

/** The calls, in the order they are sent. */
export const SCENARIO_CALLS: readonly ScenarioCall[] = [
  {
    task: SCENARIO.firstTask,
    initiative: SCENARIO.initiative,
    stage: "Implement",
    stageRun: SCENARIO.firstRun,
    role: "developer",
    model: "claude-sonnet-5",
    pipeline: "Feature",
    project: "Admin panel",
    tokens: { input: 1000, output: 200, cacheRead: 5000, cacheCreation: 300 },
    estimatedUsd: 1.5,
  },
  {
    task: SCENARIO.firstTask,
    initiative: SCENARIO.initiative,
    stage: "Implement",
    stageRun: SCENARIO.retry,
    role: "developer",
    model: "claude-sonnet-5",
    pipeline: "Feature",
    project: "Admin panel",
    tokens: { input: 500, output: 100, cacheRead: 0, cacheCreation: 0 },
    estimatedUsd: 0.75,
  },
  {
    task: SCENARIO.firstTask,
    initiative: SCENARIO.initiative,
    stage: "",
    stageRun: "",
    role: "planner",
    model: "claude-sonnet-5",
    pipeline: "Feature",
    project: "Admin panel",
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
    estimatedUsd: 0.25,
  },
  {
    task: SCENARIO.secondTask,
    initiative: "",
    stage: "Review",
    stageRun: SCENARIO.reviewRun,
    role: "reviewer",
    model: "claude-haiku-5",
    pipeline: "Feature",
    project: "Website",
    tokens: { input: 200, output: 40, cacheRead: 0, cacheCreation: 0 },
    estimatedUsd: 0.1,
  },
  {
    task: "",
    initiative: SCENARIO.initiative,
    stage: "",
    stageRun: "",
    role: "planner",
    model: "claude-sonnet-5",
    pipeline: "",
    project: "",
    tokens: { input: 300, output: 60, cacheRead: 0, cacheCreation: 0 },
    estimatedUsd: 0.4,
  },
];

/** A call's counted tokens: cache reads left out. */
export function countedTokensOf(call: ScenarioCall): number {
  return call.tokens.input + call.tokens.output + call.tokens.cacheCreation;
}

/** A recorded answer of Grafana's, with the range it was asked for. */
export interface RecordedAnswer {
  readonly range: {
    readonly from: string;
    readonly to: string;
    readonly stepSeconds: number;
  } | null;
  readonly status: number;
  readonly body: unknown;
}

export type RecordingName =
  | "data-sources"
  | "usage"
  | "windows"
  | "costliest-top"
  | "costliest-breakdown"
  | "data-source-error";

function recordingPath(name: RecordingName): string {
  return fileURLToPath(new URL(`./recorded/${name}.json`, import.meta.url));
}

export function recorded(name: RecordingName): RecordedAnswer {
  return JSON.parse(readFileSync(recordingPath(name), "utf8")) as RecordedAnswer;
}

export async function rerecord(name: RecordingName, answer: RecordedAnswer): Promise<void> {
  await writeFile(recordingPath(name), `${JSON.stringify(answer, null, 2)}\n`);
}

/** The range a recording was asked for, as a query takes it. */
export function recordedRange(name: RecordingName): { from: Date; to: Date; stepSeconds: number } {
  const { range } = recorded(name);
  if (!range) throw new Error(`The recording ${name} holds no range.`);
  return { from: new Date(range.from), to: new Date(range.to), stepSeconds: range.stepSeconds };
}
