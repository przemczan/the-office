import { z } from "zod";
import type { Effort, JsonSchema } from "../../ports/session-options.js";

/*
 * The part of the pinned app-server's protocol the adapter speaks (`codex app-server
 * generate-ts` of @openai/codex 0.169.0, its `v2` types), written by hand: what the adapter sends
 * is typed, what it reads is parsed by these schemas, which keep whatever else a message holds.
 * Compare them with a fresh `generate-ts` on every Codex bump.
 */

// ---- What the adapter sends ----

/** A part of a user message (`UserInput`): text, or an image by URL, a `data:` URL included. */
export type CodexUserInput =
  | { readonly type: "text"; readonly text: string; readonly text_elements: readonly [] }
  | { readonly type: "image"; readonly url: string };

export type CodexApprovalPolicy = "untrusted" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** A `config` of `thread/start` or `thread/resume`: settings for that thread, never written down. */
export type CodexThreadConfig = Readonly<Record<string, unknown>>;

export interface CodexThreadSettings {
  readonly cwd: string;
  readonly model?: string;
  readonly approvalPolicy?: CodexApprovalPolicy;
  readonly sandbox?: CodexSandboxMode;
  readonly config?: CodexThreadConfig;
  /** Added to Codex's own instructions, as a Role card's are to Claude Code's. */
  readonly developerInstructions?: string;
}

export interface CodexRequests {
  readonly initialize: {
    readonly params: {
      readonly clientInfo: {
        readonly name: string;
        readonly title: string | null;
        readonly version: string;
      };
      readonly capabilities: {
        readonly experimentalApi: boolean;
        readonly requestAttestation: boolean;
      };
    };
    readonly result: z.output<typeof initializeResult>;
  };
  readonly "thread/start": {
    readonly params: CodexThreadSettings & { readonly ephemeral?: boolean };
    readonly result: z.output<typeof threadOpenedResult>;
  };
  readonly "thread/resume": {
    readonly params: CodexThreadSettings & { readonly threadId: string };
    readonly result: z.output<typeof threadOpenedResult>;
  };
  readonly "turn/start": {
    readonly params: {
      readonly threadId: string;
      readonly input: readonly CodexUserInput[];
      readonly effort?: Effort;
      readonly outputSchema?: JsonSchema;
    };
    readonly result: z.output<typeof turnStartResult>;
  };
  readonly "turn/steer": {
    readonly params: {
      readonly threadId: string;
      readonly input: readonly CodexUserInput[];
      /** The running turn's id: the steer fails when another turn runs. */
      readonly expectedTurnId: string;
    };
    readonly result: z.output<typeof turnSteerResult>;
  };
  readonly "turn/interrupt": {
    readonly params: { readonly threadId: string; readonly turnId: string };
    readonly result: z.output<typeof emptyResult>;
  };
  /** Removes a thread and its history from the engine's folder, as a check cleans up after itself. */
  readonly "thread/delete": {
    readonly params: { readonly threadId: string };
    readonly result: z.output<typeof emptyResult>;
  };
  readonly "account/read": {
    readonly params: { readonly refreshToken?: boolean };
    readonly result: z.output<typeof accountResult>;
  };
  readonly "account/rateLimits/read": {
    readonly params: undefined;
    readonly result: z.output<typeof rateLimitsResult>;
  };
}

export type CodexRequestMethod = keyof CodexRequests;

// ---- What the app-server answers ----

const initializeResult = z.looseObject({
  userAgent: z.string(),
  codexHome: z.string(),
});

const threadOpenedResult = z.looseObject({
  thread: z.looseObject({ id: z.string() }),
  model: z.string(),
  reasoningEffort: z.string().nullish(),
});

/** Why a turn failed (`TurnError`); `codexErrorInfo` is a name or an object naming one. */
const turnError = z.looseObject({
  message: z.string(),
  codexErrorInfo: z.unknown().optional(),
  additionalDetails: z.string().nullish(),
});

const turn = z.looseObject({
  id: z.string(),
  status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
  error: turnError.nullish(),
});

const turnStartResult = z.looseObject({ turn });
const turnSteerResult = z.looseObject({ turnId: z.string() });
const emptyResult = z.looseObject({});

const account = z.union([
  z.looseObject({ type: z.literal("apiKey") }),
  z.looseObject({
    type: z.literal("chatgpt"),
    email: z.string().nullish(),
    planType: z.string().nullish(),
  }),
  z.looseObject({ type: z.string() }),
]);

const accountResult = z.looseObject({
  account: account.nullable(),
  requiresOpenaiAuth: z.boolean(),
});

const rateLimitWindow = z.looseObject({
  usedPercent: z.number(),
  windowDurationMins: z.number().nullish(),
  /** Unix seconds. */
  resetsAt: z.number().nullish(),
});

const rateLimitSnapshot = z.looseObject({
  limitId: z.string().nullish(),
  limitName: z.string().nullish(),
  primary: rateLimitWindow.nullish(),
  secondary: rateLimitWindow.nullish(),
  planType: z.string().nullish(),
  rateLimitReachedType: z.string().nullish(),
});

const rateLimitsResult = z.looseObject({
  rateLimits: rateLimitSnapshot,
  rateLimitsByLimitId: z.record(z.string(), rateLimitSnapshot).nullish(),
});

/** Each request's answer, checked before the caller reads it. */
export const CODEX_RESULTS: {
  readonly [M in CodexRequestMethod]: z.ZodType<CodexRequests[M]["result"]>;
} = {
  initialize: initializeResult,
  "thread/start": threadOpenedResult,
  "thread/resume": threadOpenedResult,
  "turn/start": turnStartResult,
  "turn/steer": turnSteerResult,
  "turn/interrupt": emptyResult,
  "thread/delete": emptyResult,
  "account/read": accountResult,
  "account/rateLimits/read": rateLimitsResult,
};

export type CodexTurn = z.output<typeof turn>;
export type CodexTurnError = z.output<typeof turnError>;
export type CodexRateLimitSnapshot = z.output<typeof rateLimitSnapshot>;
export type CodexRateLimitWindow = z.output<typeof rateLimitWindow>;

// ---- Thread items ----

const agentMessageItem = z.looseObject({
  type: z.literal("agentMessage"),
  id: z.string(),
  text: z.string(),
});

const commandExecutionItem = z.looseObject({
  type: z.literal("commandExecution"),
  id: z.string(),
  /** As Codex runs it: `/bin/bash -lc '<the model's command>'` on Linux. */
  command: z.string(),
  cwd: z.string(),
  status: z.enum(["inProgress", "completed", "failed", "declined"]),
  aggregatedOutput: z.string().nullish(),
  exitCode: z.number().nullish(),
});

const patchChangeKind = z.union([
  z.looseObject({ type: z.literal("add") }),
  z.looseObject({ type: z.literal("delete") }),
  z.looseObject({ type: z.literal("update"), move_path: z.string().nullish() }),
]);

const fileUpdateChange = z.looseObject({
  path: z.string(),
  kind: patchChangeKind,
  diff: z.string(),
});

const fileChangeItem = z.looseObject({
  type: z.literal("fileChange"),
  id: z.string(),
  changes: z.array(fileUpdateChange),
  status: z.enum(["inProgress", "completed", "failed", "declined"]),
});

const mcpToolCallItem = z.looseObject({
  type: z.literal("mcpToolCall"),
  id: z.string(),
  server: z.string(),
  tool: z.string(),
  status: z.enum(["inProgress", "completed", "failed"]),
  arguments: z.unknown(),
  result: z
    .looseObject({ content: z.array(z.unknown()), structuredContent: z.unknown().optional() })
    .nullish(),
  error: z.looseObject({ message: z.string() }).nullish(),
});

const KNOWN_ITEMS = {
  agentMessage: agentMessageItem,
  commandExecution: commandExecutionItem,
  fileChange: fileChangeItem,
  mcpToolCall: mcpToolCallItem,
} as const;

export type CodexAgentMessageItem = z.output<typeof agentMessageItem>;
export type CodexCommandExecutionItem = z.output<typeof commandExecutionItem>;
export type CodexFileChangeItem = z.output<typeof fileChangeItem>;
export type CodexFileUpdateChange = z.output<typeof fileUpdateChange>;
export type CodexMcpToolCallItem = z.output<typeof mcpToolCallItem>;

/** An item the adapter doesn't read, such as reasoning or a plan, by its type. */
export interface CodexOtherItem {
  readonly type: "other";
  readonly itemType: string;
  readonly id: string;
}

export type CodexThreadItem =
  | CodexAgentMessageItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexOtherItem;

const anyItem = z.looseObject({ type: z.string(), id: z.string() });

/**
 * A thread item, one of those the adapter reads, or any other by its type; one of them that
 * doesn't parse is read as any other, so a changed shape never stops a session.
 */
const threadItem = z.unknown().transform((value, context): CodexThreadItem => {
  const item = anyItem.safeParse(value);
  if (!item.success) {
    context.addIssue({ code: "custom", message: "A thread item needs a type and an id." });
    return z.NEVER;
  }
  const schema = KNOWN_ITEMS[item.data.type as keyof typeof KNOWN_ITEMS] as
    z.ZodType<CodexThreadItem> | undefined;
  const known = schema?.safeParse(value);
  return known?.success === true
    ? known.data
    : { type: "other", itemType: item.data.type, id: item.data.id };
});

// ---- Notifications ----

const itemNotification = z.looseObject({
  threadId: z.string(),
  turnId: z.string(),
  item: threadItem,
});

const turnNotification = z.looseObject({ threadId: z.string(), turn });

const tokenUsageBreakdown = z.looseObject({
  totalTokens: z.number(),
  /** Cached input included. */
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  cacheWriteInputTokens: z.number().optional(),
  /** Reasoning included. */
  outputTokens: z.number(),
  reasoningOutputTokens: z.number().optional(),
});

const NOTIFICATIONS = {
  "turn/started": turnNotification,
  "turn/completed": turnNotification,
  "item/started": itemNotification,
  "item/completed": itemNotification,
  "thread/tokenUsage/updated": z.looseObject({
    threadId: z.string(),
    turnId: z.string(),
    tokenUsage: z.looseObject({
      /** The thread's from its start. */
      total: tokenUsageBreakdown,
      /** The latest model call's. */
      last: tokenUsageBreakdown,
      modelContextWindow: z.number().nullish(),
    }),
  }),
  /** A sparse update: what it leaves out keeps its last reading. */
  "account/rateLimits/updated": z.looseObject({ rateLimits: rateLimitSnapshot }),
  error: z.looseObject({
    error: turnError,
    willRetry: z.boolean(),
    threadId: z.string(),
    turnId: z.string(),
  }),
} as const;

type Notifications = typeof NOTIFICATIONS;

/** A notification the adapter reads; the app-server's others are ignored. */
export type CodexNotification = {
  [M in keyof Notifications]: { readonly method: M; readonly params: z.output<Notifications[M]> };
}[keyof Notifications];

export type CodexTokenUsage = z.output<typeof tokenUsageBreakdown>;

/** The notification a message is, or undefined for one the adapter doesn't read or can't. */
export function codexNotification(method: string, params: unknown): CodexNotification | undefined {
  if (!Object.hasOwn(NOTIFICATIONS, method)) return undefined;
  const parsed = NOTIFICATIONS[method as keyof Notifications].safeParse(params);
  return parsed.success ? ({ method, params: parsed.data } as CodexNotification) : undefined;
}

// ---- Server requests ----

export const COMMAND_APPROVAL = "item/commandExecution/requestApproval";
export const FILE_CHANGE_APPROVAL = "item/fileChange/requestApproval";
export const PERMISSIONS_APPROVAL = "item/permissions/requestApproval";
export const MCP_ELICITATION = "mcpServer/elicitation/request";

const SERVER_REQUESTS = {
  [COMMAND_APPROVAL]: z.looseObject({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    /** `command`, a person's own `humanCommand`, or `writeStdin` to a running command. */
    kind: z.string().default("command"),
    /** Set when the command asks to run outside the sandbox, such as with the network. */
    reason: z.string().nullish(),
    command: z.string().nullish(),
    cwd: z.string().nullish(),
    additionalPermissions: z.unknown().optional(),
    networkApprovalContext: z.unknown().optional(),
  }),
  [FILE_CHANGE_APPROVAL]: z.looseObject({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    reason: z.string().nullish(),
    /** Asks to write anywhere under this folder for the rest of the session. */
    grantRoot: z.string().nullish(),
  }),
  [PERMISSIONS_APPROVAL]: z.looseObject({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    reason: z.string().nullish(),
    permissions: z.unknown(),
  }),
  [MCP_ELICITATION]: z.looseObject({
    threadId: z.string(),
    turnId: z.string().nullish(),
    serverName: z.string(),
    mode: z.string(),
    message: z.string().optional(),
    /**
     * For a tool call's approval: `codex_approval_kind: "mcp_tool_call"`, `tool_name` and the
     * call's arguments, `tool_params`.
     */
    _meta: z.unknown().optional(),
  }),
} as const;

type ServerRequests = typeof SERVER_REQUESTS;

/** A request of the app-server's the adapter answers; it answers any other with an error. */
export type CodexServerRequest = {
  [M in keyof ServerRequests]: { readonly method: M; readonly params: z.output<ServerRequests[M]> };
}[keyof ServerRequests];

export type CodexCommandApprovalParams = z.output<ServerRequests[typeof COMMAND_APPROVAL]>;
export type CodexFileChangeApprovalParams = z.output<ServerRequests[typeof FILE_CHANGE_APPROVAL]>;
export type CodexElicitationParams = z.output<ServerRequests[typeof MCP_ELICITATION]>;

/** The request a message is: known and parsed, known but not as expected, or unknown. */
export function codexServerRequest(
  method: string,
  params: unknown,
):
  | { readonly kind: "known"; readonly request: CodexServerRequest }
  | { readonly kind: "malformed"; readonly problem: string }
  | { readonly kind: "unknown" } {
  if (!Object.hasOwn(SERVER_REQUESTS, method)) return { kind: "unknown" };
  const parsed = SERVER_REQUESTS[method as keyof ServerRequests].safeParse(params);
  return parsed.success
    ? { kind: "known", request: { method, params: parsed.data } as CodexServerRequest }
    : { kind: "malformed", problem: z.prettifyError(parsed.error) };
}

// ---- User messages ----

/** A user message as the app-server takes it: its text, then each image as a `data:` URL. */
export function codexUserInput(
  text: string,
  images: readonly { readonly mediaType: string; readonly content: Uint8Array }[] = [],
): CodexUserInput[] {
  return [
    { type: "text", text, text_elements: [] },
    ...images.map(({ mediaType, content }): CodexUserInput => ({
      type: "image",
      url: `data:${mediaType};base64,${Buffer.from(content).toString("base64")}`,
    })),
  ];
}
