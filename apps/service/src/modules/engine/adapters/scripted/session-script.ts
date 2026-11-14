import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { UsageWindows } from "../../domain/usage-windows.js";
import type { ContextUsage, MessagePriority, UserMessage } from "../../ports/engine-session.js";
import type { SessionEvent } from "../../ports/session-events.js";

/**
 * One thing that happened in a session, in order: what its caller did (start, resume, send,
 * interrupt, read the usage windows, end) and what the session reported (an event).
 */
export type ScriptStep =
  | ({ readonly step: "start"; readonly brief: UserMessage } & SkillListing)
  | ({ readonly step: "resume" } & SkillListing)
  | { readonly step: "send"; readonly message: UserMessage; readonly priority: MessagePriority }
  | { readonly step: "interrupt" }
  | { readonly step: "read-usage-windows"; readonly windows: UsageWindows | undefined }
  | { readonly step: "read-context-usage"; readonly usage: ContextUsage }
  | { readonly step: "end" }
  | EventStep
  | WaitStep;

export interface EventStep {
  readonly step: "event";
  readonly event: SessionEvent;
  /**
   * For a refused turn's end, its window resets this many seconds after the replay reaches it, in
   * place of the script's `resetsAt`, so a test can see the reset come. Never recorded: a test
   * writes it.
   */
  readonly resetsInSeconds?: number;
}

/**
 * The replay holds here until the test reaches the mark (`ScriptedSession.reach`), such as a
 * Process running between turns while a page opens. Never recorded: a test writes it.
 */
export interface WaitStep {
  readonly step: "wait";
  readonly mark: string;
}

export type CallerStep = Exclude<ScriptStep, { step: "event" | "wait" }>;

/**
 * What the engine listed as the session opened, for a script that tests the start check; a
 * script without it opens whatever the session's skills.
 */
interface SkillListing {
  readonly listedSkills?: readonly string[];
}

/** What a caller does, as a step without what the session answered. */
export type CallerRequest =
  | Exclude<CallerStep, { step: ReadStep }>
  | { readonly step: "read-usage-windows" }
  | { readonly step: "read-context-usage" };

/**
 * The reads the replay answers whenever they come, from what the script recorded, since who reads
 * and when is the Office's.
 */
export type ReadStep = "read-usage-windows" | "read-context-usage";

/** One session from its start or resume on: the first step is either. */
export type SessionScript = readonly ScriptStep[];

/** The places a recording names by placeholder, so one made in one folder, on one system, replays in any other. */
export interface RecordedPlaces {
  /** The session's working folder. */
  readonly folder: string;
  /** The home folder of the user it ran as. */
  readonly home: string;
}

const PLACES = ["folder", "home"] as const satisfies readonly (keyof RecordedPlaces)[];

export const PLACEHOLDERS: Readonly<Record<keyof RecordedPlaces, string>> = {
  folder: "<folder>",
  home: "<home>",
};

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

const backgroundEnding = z.discriminatedUnion("state", [
  z.object({ state: z.literal("finished") }),
  z.object({ state: z.literal("failed"), reason: z.string() }),
  z.object({ state: z.literal("stopped"), by: z.enum(["agent", "interrupt", "session-end"]) }),
]);

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
    // Recordings made before Sub-agents were followed leave it out.
    withinToolCall: z
      .string()
      .nullish()
      .transform((value) => value ?? undefined),
  }),
  z.object({
    kind: z.literal("tool-refused"),
    callId: z.string(),
    tool: z.string(),
    reason: z.string(),
    refusedBy: z.enum(["office-rules", "engine"]),
  }),
  z.object({ kind: z.literal("turn-tokens"), soFar: tokenUsage }),
  z.object({ kind: z.literal("context-read"), tokens: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal("turn-ended"),
    outcome: z.enum(["completed", "interrupted", "failed", "usage-window-used-up"]),
    consumedMessageIds: z.array(z.string()),
    usage: tokenUsage,
    sessionCostUsd: z.number(),
    output: absent(z.unknown()),
    errors: z.array(z.string()),
    usedUpWindow: z
      .object({ window: z.string(), resetsAt: z.coerce.date(), resetGiven: z.boolean() })
      .optional(),
  }),
  z.object({
    kind: z.literal("rate-limit"),
    status: z.enum(["allowed", "warning", "rejected"]),
    // Recordings made before refused turns were told apart leave it out.
    window: z
      .string()
      .nullish()
      .transform((value) => value ?? undefined),
    resetsAt: absent(z.coerce.date()),
  }),
  z.object({
    kind: z.literal("mcp-server-not-started"),
    server: z.string(),
    reason: absent(z.string()),
  }),
  z.object({
    kind: z.literal("sub-agent-started"),
    callId: z.string(),
    engineTaskId: absent(z.string()),
    withinToolCall: absent(z.string()),
    description: z.string(),
    agentKind: absent(z.string()),
    prompt: z.string(),
    background: z.boolean(),
  }),
  z.object({
    kind: z.literal("sub-agent-changed"),
    callId: z.string(),
    engineTaskId: absent(z.string()),
    background: z.boolean(),
  }),
  z.object({
    kind: z.literal("sub-agent-ended"),
    callId: z.string(),
    ending: backgroundEnding,
    reportedBack: absent(z.string()),
    toolCallCount: absent(z.number()),
    totalTokens: absent(z.number()),
  }),
  z.object({
    kind: z.literal("process-started"),
    callId: z.string(),
    engineTaskId: z.string(),
    withinToolCall: absent(z.string()),
    commandLine: z.string(),
    description: z.string(),
  }),
  z.object({ kind: z.literal("process-output"), callId: z.string(), text: z.string() }),
  z.object({
    kind: z.literal("process-ended"),
    callId: z.string(),
    ending: backgroundEnding,
    exitCode: absent(z.number()),
  }),
]) satisfies z.ZodType<SessionEvent, unknown>;

const scriptStep = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("start"),
    brief: userMessage,
    listedSkills: z.array(z.string()).optional(),
  }),
  z.object({ step: z.literal("resume"), listedSkills: z.array(z.string()).optional() }),
  z.object({
    step: z.literal("send"),
    message: userMessage,
    priority: z.enum(["next", "later"]),
  }),
  z.object({ step: z.literal("interrupt") }),
  z.object({
    step: z.literal("read-usage-windows"),
    windows: absent(
      z.object({
        fiveHour: usageWindow,
        sevenDay: usageWindow,
        // Recordings made before readings had a source leave it out.
        source: z
          .enum(["usage-endpoint", "rate-limit-headers"])
          .nullish()
          .transform((value) => value ?? undefined),
      }),
    ),
  }),
  z.object({
    step: z.literal("read-context-usage"),
    usage: z.object({ tokens: z.number(), window: z.number() }),
  }),
  z.object({ step: z.literal("end") }),
  z.object({
    step: z.literal("event"),
    event: sessionEvent,
    resetsInSeconds: z.number().positive().optional(),
  }),
  z.object({ step: z.literal("wait"), mark: z.string() }),
]) satisfies z.ZodType<ScriptStep, unknown>;

/**
 * Reads a recording: one step per line, as JSON, each session beginning at its start or resume.
 * Its steps name places by placeholder, which `inPlaces` resolves.
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

/**
 * Writes sessions as `readRecording` reads them, each mention of their places replaced by its
 * placeholder.
 */
export async function writeRecording(
  file: string,
  sessions: readonly { readonly places: RecordedPlaces; readonly script: SessionScript }[],
): Promise<void> {
  const lines = sessions.flatMap(({ places, script }) =>
    script.map((step) =>
      JSON.stringify(withPlaceholders(step, places), (_key, value: unknown) =>
        value === undefined ? null : value,
      ),
    ),
  );
  await writeFile(file, lines.map((line) => `${line}\n`).join(""));
}

/** A step of a recording as it happens in these places. */
export function inPlaces<Step extends ScriptStep>(step: Step, places: RecordedPlaces): Step {
  return PLACES.reduce<unknown>(
    (value, place) => replaceInStrings(value, PLACEHOLDERS[place], places[place]),
    step,
  ) as Step;
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

/**
 * Engines and models write a Windows path with either separator; both become the placeholder.
 * The working folder goes first, as it may lie in the home folder.
 */
function withPlaceholders(step: ScriptStep, places: RecordedPlaces): unknown {
  return PLACES.flatMap((place) =>
    [...new Set([places[place], places[place].replaceAll("\\", "/")])].map(
      (spelling) => [spelling, PLACEHOLDERS[place]] as const,
    ),
  ).reduce<unknown>(
    (value, [spelling, placeholder]) => replaceInStrings(value, spelling, placeholder),
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
