/**
 * The parts of the Codex app-server protocol the check reads, written by hand from
 * `codex app-server generate-ts` of @openai/codex 0.169.0 (the `v2` types). Regenerate and compare on
 * every Codex bump; only what a check reads is here.
 */

import type { Json } from "../json.ts";

export type AskForApproval = "untrusted" | "on-request" | "never";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export type Account =
  | { readonly type: "apiKey" }
  | { readonly type: "chatgpt"; readonly planType: string }
  | { readonly type: "amazonBedrock" }
  | { readonly type: "gcp" };

/** `initialize`'s answer. */
export interface InitializeResponse {
  readonly userAgent: string;
  readonly codexHome: string;
  readonly platformOs: string;
}

/** `account/read`'s answer: `account` is null until the folder is signed in. */
export interface GetAccountResponse {
  readonly account: Account | null;
  readonly requiresOpenaiAuth: boolean;
}

export interface Model {
  readonly id: string;
  readonly hidden: boolean;
  readonly supportedReasoningEfforts: readonly { readonly reasoningEffort: ReasoningEffort }[];
}

export interface ModelListResponse {
  readonly data: readonly Model[];
  readonly nextCursor: string | null;
}

/** One `config/read` layer; `name.file` is where it was read from. */
export interface ConfigLayer {
  readonly name: { readonly type: string; readonly file?: string };
  /** Set on a layer Codex found but does not apply, such as an untrusted project's. */
  readonly disabledReason?: string | null;
}

export interface ConfigReadResponse {
  readonly config: {
    readonly projects?: Readonly<Record<string, { readonly trust_level?: string }>> | null;
    readonly model_verbosity?: string | null;
  };
  readonly layers?: readonly ConfigLayer[] | null;
}

export interface RateLimitWindow {
  readonly usedPercent: number;
  readonly windowDurationMins: number | null;
  /** Unix seconds. */
  readonly resetsAt: number | null;
}

export interface RateLimitSnapshot {
  readonly limitId: string | null;
  readonly primary: RateLimitWindow | null;
  readonly secondary: RateLimitWindow | null;
  readonly planType: string | null;
  readonly rateLimitReachedType: string | null;
}

export interface GetAccountRateLimitsResponse {
  readonly rateLimits: RateLimitSnapshot;
  readonly rateLimitsByLimitId: Readonly<Record<string, RateLimitSnapshot>> | null;
}

export interface TokenUsageBreakdown {
  readonly totalTokens: number;
  /** Includes the cached input. */
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  /** Includes the reasoning output. */
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
}

/** `thread/tokenUsage/updated`: `total` is the thread's from its start, `last` the latest model call's. */
export interface ThreadTokenUsageUpdatedNotification {
  readonly threadId: string;
  readonly turnId: string;
  readonly tokenUsage: {
    readonly total: TokenUsageBreakdown;
    readonly last: TokenUsageBreakdown;
    readonly modelContextWindow: number | null;
  };
}

export interface Thread {
  readonly id: string;
}

/** `thread/start`'s and `thread/resume`'s answer. */
export interface ThreadOpenedResponse {
  readonly thread: Thread;
  readonly model: string;
  /** A policy name, or an object for the granular one. */
  readonly approvalPolicy: Json;
  readonly sandbox: { readonly type: string };
  readonly reasoningEffort: ReasoningEffort | null;
}

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export interface TurnError {
  readonly message: string;
  readonly codexErrorInfo: unknown;
}

export interface Turn {
  readonly id: string;
  readonly status: TurnStatus;
  readonly error: TurnError | null;
}

export interface TurnStartResponse {
  readonly turn: Turn;
}

/** `turn/completed`, which ends every turn, interrupted and failed ones too. */
export interface TurnCompletedNotification {
  readonly threadId: string;
  readonly turn: Turn;
}

export type ItemStatus = "inProgress" | "completed" | "failed" | "declined";

export type ThreadItem =
  | { readonly type: "agentMessage"; readonly id: string; readonly text: string }
  | {
      readonly type: "commandExecution";
      readonly id: string;
      readonly command: string;
      readonly status: ItemStatus;
      readonly exitCode: number | null;
      readonly aggregatedOutput: string | null;
    }
  | {
      readonly type: "fileChange";
      readonly id: string;
      readonly changes: readonly { readonly path: string }[];
      readonly status: ItemStatus;
    }
  | {
      readonly type: "mcpToolCall";
      readonly id: string;
      readonly server: string;
      readonly tool: string;
      readonly status: "inProgress" | "completed" | "failed";
      readonly arguments: unknown;
    }
  | { readonly type: string; readonly id: string };

/** `item/started` and `item/completed`. */
export interface ItemNotification {
  readonly threadId: string;
  readonly turnId: string;
  readonly item: ThreadItem;
}

/** The server requests that ask the client to approve something (`ServerRequest`). */
export const APPROVAL_REQUESTS = {
  command: "item/commandExecution/requestApproval",
  fileChange: "item/fileChange/requestApproval",
  permissions: "item/permissions/requestApproval",
  mcpElicitation: "mcpServer/elicitation/request",
} as const;

export type ApprovalRequestMethod = (typeof APPROVAL_REQUESTS)[keyof typeof APPROVAL_REQUESTS];

/** What every approval request carries; a command's also names the command and its reason. */
export interface ApprovalRequestParams {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId?: string;
  readonly command?: string | null;
  readonly reason?: string | null;
  readonly kind?: string;
  readonly serverName?: string;
}
