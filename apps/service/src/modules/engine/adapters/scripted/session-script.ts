import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { MessagePriority, UsageWindows, UserMessage } from "../../ports/engine-session.js";
import type { SessionEvent } from "../../ports/session-events.js";

/**
 * One thing that happened in a session, in order: what its caller did (start, resume, send,
 * interrupt, read the usage windows, end) and what the session reported (an event).
 */
export type ScriptStep =
  | { readonly step: "start"; readonly brief: UserMessage }
  | { readonly step: "resume" }
  | { readonly step: "send"; readonly message: UserMessage; readonly priority: MessagePriority }
  | { readonly step: "interrupt" }
  | { readonly step: "read-usage-windows"; readonly windows: UsageWindows }
  | { readonly step: "end" }
  | { readonly step: "event"; readonly event: SessionEvent };

export type CallerStep = Exclude<ScriptStep, { step: "event" }>;

/** What a caller does, as a step without what the session answered. */
export type CallerRequest =
  Exclude<CallerStep, { step: "read-usage-windows" }> | { readonly step: "read-usage-windows" };

/** One session from its start or resume on: the first step is either. */
export type SessionScript = readonly ScriptStep[];

/**
 * Stands for the session's working folder in a recording, so a recording made in one folder, on
 * one system, replays in any other.
 */
export const FOLDER_PLACEHOLDER = "<folder>";

/** A value the engine left out is written as null, which JSON keeps, and read back as undefined. */
const absent = <Schema extends z.ZodType>(schema: Schema) =>
  schema.nullable().transform((value) => value ?? undefined);

const userMessage = z.object({ id: z.string(), text: z.string() });

const tokenUsage = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheCreation: z.number(),
});

const usageWindow = z.object({
  percentUsed: z.number(),
  resetsAt: absent(z.coerce.date()),
});

const sessionEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string(), withinToolCall: absent(z.string()) }),
  z.object({
    kind: z.literal("tool-call"),
    callId: z.string(),
    tool: z.string(),
    officeTool: z.boolean(),
    input: z.unknown(),
    withinToolCall: absent(z.string()),
  }),
  z.object({
    kind: z.literal("tool-result"),
    callId: z.string(),
    text: z.string(),
    isError: z.boolean(),
  }),
  z.object({
    kind: z.literal("turn-ended"),
    outcome: z.enum(["completed", "interrupted", "failed"]),
    consumedMessageIds: z.array(z.string()),
    usage: tokenUsage,
    costUsd: z.number(),
    output: absent(z.unknown()),
    errors: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("rate-limit"),
    status: z.enum(["allowed", "warning", "rejected"]),
    resetsAt: absent(z.coerce.date()),
  }),
]) satisfies z.ZodType<SessionEvent, unknown>;

const scriptStep = z.discriminatedUnion("step", [
  z.object({ step: z.literal("start"), brief: userMessage }),
  z.object({ step: z.literal("resume") }),
  z.object({
    step: z.literal("send"),
    message: userMessage,
    priority: z.enum(["next", "later"]),
  }),
  z.object({ step: z.literal("interrupt") }),
  z.object({
    step: z.literal("read-usage-windows"),
    windows: z.object({ fiveHour: usageWindow, sevenDay: usageWindow }),
  }),
  z.object({ step: z.literal("end") }),
  z.object({ step: z.literal("event"), event: sessionEvent }),
]) satisfies z.ZodType<ScriptStep, unknown>;

/**
 * Reads a recording: one step per line, as JSON, each session beginning at its start or resume.
 * Its steps name the working folder by the placeholder, which `inFolder` resolves.
 */
export async function readRecording(file: string): Promise<SessionScript[]> {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/).filter((line) => line.trim() !== "");
  const steps = lines.map((line, index) => {
    const parsed = scriptStep.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(
        `${file}:${index + 1} is not a script step: ${z.prettifyError(parsed.error)}`,
      );
    }
    return parsed.data;
  });
  return splitIntoSessions(steps, file);
}

/** Writes sessions as `readRecording` reads them, each mention of their working folder replaced by the placeholder. */
export async function writeRecording(
  file: string,
  sessions: readonly { readonly folder: string; readonly script: SessionScript }[],
): Promise<void> {
  const lines = sessions.flatMap(({ folder, script }) =>
    script.map((step) =>
      JSON.stringify(withFolderPlaceholder(step, folder), (_key, value: unknown) =>
        value === undefined ? null : value,
      ),
    ),
  );
  await writeFile(file, lines.map((line) => `${line}\n`).join(""));
}

/** A step of a recording as it happens in `folder`. */
export function inFolder<Step extends ScriptStep>(step: Step, folder: string): Step {
  return replaceInStrings(step, FOLDER_PLACEHOLDER, folder) as Step;
}

function splitIntoSessions(steps: readonly ScriptStep[], file: string): SessionScript[] {
  const sessions: ScriptStep[][] = [];
  for (const step of steps) {
    if (step.step === "start" || step.step === "resume") {
      sessions.push([step]);
    } else if (sessions.length === 0) {
      throw new Error(
        `${file} begins with a ${step.step} step; a session begins at a start or resume.`,
      );
    } else {
      sessions.at(-1)?.push(step);
    }
  }
  return sessions;
}

/** Engines and models write a Windows path with either separator; both become the placeholder. */
function withFolderPlaceholder(step: ScriptStep, folder: string): unknown {
  const spellings = [...new Set([folder, folder.replaceAll("\\", "/")])];
  return spellings.reduce<unknown>(
    (value, spelling) => replaceInStrings(value, spelling, FOLDER_PLACEHOLDER),
    step,
  );
}

function replaceInStrings(value: unknown, search: string, replacement: string): unknown {
  if (typeof value === "string") return value.replaceAll(search, replacement);
  if (Array.isArray(value)) return value.map((item) => replaceInStrings(item, search, replacement));
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, replaceInStrings(item, search, replacement)]),
  );
}
