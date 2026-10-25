import {
  query,
  type HookCallbackMatcher,
  type HookEvent,
  type HookInput,
  type HookJSONOutput,
  type Options,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKUserMessage,
  type Settings,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { InputChannel } from "./input-channel.ts";
import { SESSION_PLUGIN_NAME, type Sandbox, type SkillFixture } from "./sandbox.ts";
import { sessionEnvironment } from "./session-environment.ts";

/** The cheapest model that proves the point: checks observe the engine, not the model's quality. */
export const CHECK_MODEL = "claude-haiku-5-5";

/**
 * The engine's built-in plugins, turned off by id (spec §5.6); a release that adds one shows in
 * `skills.start-check` as another plugin beside the session's.
 */
const BUILT_IN_PLUGINS = [
  "cc-plugin-agents-md",
  "cc-plugin-telemetry",
  "cc-plugin-plugin-authoring",
];

/**
 * The built-in tools, named explicitly so both platforms get the same set (spec §5.4): the engine's
 * Linux default drops Grep and Glob for shell search. This is the Windows default of 2.1.310.
 */
const OFFICE_TOOLS = [
  "Bash",
  "CronCreate",
  "CronDelete",
  "CronList",
  "DesignSync",
  "Edit",
  "EnterWorktree",
  "ExitWorktree",
  "Glob",
  "Grep",
  "ListAgents",
  "Monitor",
  "NotebookEdit",
  "PushNotification",
  "Read",
  "RemoteTrigger",
  "ReportFindings",
  "ScheduleWakeup",
  "SendMessage",
  "Skill",
  "Task",
  "TaskStop",
  "ToolSearch",
  "WebSearch",
  "Workflow",
  "Write",
  ...(process.platform === "win32" ? ["PowerShell"] : []),
];

/** Hook events the Office registers; a check registers more only when it observes them. */
const OFFICE_HOOK_EVENTS: readonly HookEvent[] = ["PreToolUse", "PostToolUse", "PermissionDenied"];

export type ProbeHook = (input: HookInput, session: ProbeSession) => Promise<HookJSONOutput>;

export interface SessionSpec {
  readonly repository: string;
  /** Copied into the session plugin folder. */
  readonly skills?: readonly SkillFixture[];
  /** Further plugin folders loaded beside the session plugin. */
  readonly additionalPlugins?: readonly string[];
  /** The `skills` allowlist; defaults to `office:<name>` for each of `skills`. */
  readonly allowedSkills?: readonly string[];
  /** Merged over the spec §5.4, §5.6 and §6 settings; `permissions` merges a level deeper. */
  readonly settings?: Settings;
  /** Decides a hook call; events without one are recorded and allowed to continue. */
  readonly hooks?: Partial<Record<HookEvent, ProbeHook>>;
  /** Session id to resume; the plugin folder is rebuilt from `skills`, as the Office does. */
  readonly resume?: string;
  /** Id for a new session, chosen up front as the Office does, since it names the plugin folder; random when omitted. */
  readonly sessionId?: string;
  /** Last-word overrides for what a check varies on purpose. */
  readonly options?: Partial<Options>;
}

export interface HookCall {
  readonly event: HookEvent;
  readonly toolUseId: string | undefined;
  readonly input: HookInput;
  /** How many stream messages had arrived when the hook was called. */
  readonly messageIndex: number;
  output?: HookJSONOutput;
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

export interface MessageDelivery {
  readonly priority?: SDKUserMessage["priority"];
  readonly shouldQuery?: boolean;
  readonly origin?: SDKUserMessage["origin"];
}

interface Waiter {
  readonly predicate: (message: SDKMessage) => boolean;
  cursor: number;
  readonly resolve: (index: number) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * One long-lived streaming `query()` started with the options the Office ships (spec §5.6, §6),
 * recording every stream message and hook call so a check can observe the engine.
 */
export class ProbeSession {
  readonly messages: SDKMessage[] = [];
  readonly hookCalls: HookCall[] = [];
  private readonly stderrChunks: string[] = [];
  private readonly input = new InputChannel<SDKUserMessage>();
  private readonly waiters = new Set<Waiter>();
  private resultCursor = 0;
  private ended = false;
  private failure: unknown;
  readonly sessionId: string;
  readonly repository: string;
  readonly pluginFolder: string;
  private readonly signal: AbortSignal;
  private readonly engine: Query;
  private readonly consumed: Promise<void>;

  private constructor(
    sessionId: string,
    pluginFolder: string,
    spec: SessionSpec,
    signal: AbortSignal,
  ) {
    this.sessionId = sessionId;
    this.repository = spec.repository;
    this.pluginFolder = pluginFolder;
    this.signal = signal;
    this.engine = query({ prompt: this.input, options: this.buildOptions(spec) });
    this.consumed = this.consume();
    signal.addEventListener("abort", () => this.rejectWaiters(signal.reason), { once: true });
  }

  static async start(
    sandbox: Sandbox,
    spec: SessionSpec,
    signal: AbortSignal,
  ): Promise<ProbeSession> {
    const sessionId = spec.resume ?? spec.sessionId ?? randomUUID();
    const pluginFolder = await sandbox.writeSessionPlugin(sessionId, spec.skills ?? []);
    return new ProbeSession(sessionId, pluginFolder, spec, signal);
  }

  /** The SDK's control surface: interrupt, context usage, usage windows, initialization result. */
  get control(): Query {
    return this.engine;
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }

  /** Returns the uuid the message is stamped with, which a result's `user_message_uuids` names once a turn consumed it. */
  send(text: string, delivery: MessageDelivery = {}): string {
    const uuid = randomUUID();
    this.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid,
      ...delivery,
    });
    return uuid;
  }

  init(): Promise<SDKSystemMessage> {
    return this.waitForMessage(
      (message): message is SDKSystemMessage =>
        message.type === "system" && message.subtype === "init",
    );
  }

  /**
   * `init` without a model call: a message that does not query still starts the session and runs the
   * turn-start attachments, the skill listing among them; its text joins the next message that queries.
   */
  async initWithoutTurn(): Promise<SDKSystemMessage> {
    this.send("Session started.", { shouldQuery: false });
    const init = await this.init();
    // That message still ends in a result; taking it here leaves nextResult() to real turns.
    await this.nextResult();
    return init;
  }

  /** The next turn's result not yet returned by an earlier call. */
  async nextResult(): Promise<SDKResultMessage> {
    const index = await this.waitForIndex(
      (message) => message.type === "result",
      this.resultCursor,
    );
    this.resultCursor = index + 1;
    return this.messages[index] as SDKResultMessage;
  }

  async waitForMessage<T extends SDKMessage>(
    predicate: (message: SDKMessage) => message is T,
    from = 0,
  ): Promise<T> {
    const index = await this.waitForIndex(predicate, from);
    return this.messages[index] as T;
  }

  /** Main-loop tokens summed over every turn; a resumed session's earlier turns are not counted again. */
  tokens(): TokenUsage {
    return this.messages
      .filter((message): message is SDKResultMessage => message.type === "result")
      .reduce<TokenUsage>(
        (total, { usage }) => ({
          input: total.input + usage.input_tokens,
          output: total.output + usage.output_tokens,
          cacheRead: total.cacheRead + usage.cache_read_input_tokens,
          cacheCreation: total.cacheCreation + usage.cache_creation_input_tokens,
        }),
        { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      );
  }

  async close(): Promise<void> {
    this.input.close();
    this.engine.close();
    await this.consumed;
  }

  private buildOptions(spec: SessionSpec): Options {
    const abortController = new AbortController();
    this.signal.addEventListener("abort", () => abortController.abort(this.signal.reason), {
      once: true,
    });
    const skills = spec.skills ?? [];
    return {
      cwd: spec.repository,
      model: CHECK_MODEL,
      tools: OFFICE_TOOLS,
      settingSources: ["project"],
      plugins: [this.pluginFolder, ...(spec.additionalPlugins ?? [])].map((path) => ({
        type: "local",
        path,
        skipMcpDiscovery: true,
      })),
      skills: [
        ...(spec.allowedSkills ?? skills.map((skill) => `${SESSION_PLUGIN_NAME}:${skill.name}`)),
      ],
      settings: sessionSettings(this.pluginFolder, spec.settings),
      permissionPrompts: "none",
      systemPrompt: { type: "preset", preset: "claude_code", excludeDynamicSections: true },
      env: sessionEnvironment(),
      hooks: this.hookMatchers(spec.hooks ?? {}),
      abortController,
      stderr: (chunk) => this.stderrChunks.push(chunk),
      ...(spec.resume === undefined ? { sessionId: this.sessionId } : { resume: spec.resume }),
      ...spec.options,
    };
  }

  private hookMatchers(
    hooks: Partial<Record<HookEvent, ProbeHook>>,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const events = new Set<HookEvent>([
      ...OFFICE_HOOK_EVENTS,
      ...(Object.keys(hooks) as HookEvent[]),
    ]);
    return Object.fromEntries(
      [...events].map((event) => [
        event,
        [
          {
            hooks: [
              async (input: HookInput, toolUseId: string | undefined): Promise<HookJSONOutput> => {
                const call: HookCall = {
                  event,
                  toolUseId,
                  input,
                  messageIndex: this.messages.length,
                };
                this.hookCalls.push(call);
                call.output = (await hooks[event]?.(input, this)) ?? {};
                return call.output;
              },
            ],
          },
        ],
      ]),
    );
  }

  private async consume(): Promise<void> {
    try {
      for await (const message of this.engine) {
        this.messages.push(message);
        this.notifyWaiters();
      }
    } catch (error) {
      this.failure = error;
    } finally {
      this.ended = true;
      this.notifyWaiters();
    }
  }

  private waitForIndex(predicate: (message: SDKMessage) => boolean, from: number): Promise<number> {
    if (this.signal.aborted) {
      return Promise.reject(this.signal.reason);
    }
    return new Promise((resolve, reject) => {
      this.waiters.add({ predicate, cursor: from, resolve, reject });
      this.notifyWaiters();
    });
  }

  private notifyWaiters(): void {
    for (const waiter of this.waiters) {
      for (; waiter.cursor < this.messages.length; waiter.cursor++) {
        if (waiter.predicate(this.messages[waiter.cursor] as SDKMessage)) {
          this.waiters.delete(waiter);
          waiter.resolve(waiter.cursor);
          break;
        }
      }
      if (this.ended && this.waiters.has(waiter)) {
        this.waiters.delete(waiter);
        waiter.reject(
          this.failure ?? new Error(`Session ${this.sessionId} ended before the awaited message`),
        );
      }
    }
  }

  private rejectWaiters(reason: unknown): void {
    for (const waiter of this.waiters) {
      waiter.reject(reason);
    }
    this.waiters.clear();
  }
}

function sessionSettings(pluginFolder: string, overrides: Settings = {}): Settings {
  return {
    syncClaudeAiSkills: false,
    syncClaudeAiPlugins: false,
    disableBundledSkills: true,
    disableClaudeAiConnectors: true,
    autoMemoryEnabled: false,
    autoDreamEnabled: false,
    enabledPlugins: Object.fromEntries(
      BUILT_IN_PLUGINS.map((plugin) => [`${plugin}@builtin`, false]),
    ),
    ...overrides,
    permissions: {
      blockReadsOutsideWorkingDirectories: true,
      additionalDirectories: [pluginFolder],
      ...overrides.permissions,
    },
  };
}
