import {
  query,
  type HookCallbackMatcher,
  type HookEvent,
  type HookInput,
  type HookJSONOutput,
  type Options,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { InputChannel } from "./input-channel.ts";
import {
  allowedSkillNames,
  CHECK_MODEL,
  hookEvents,
  OFFICE_TOOLS,
  sessionSettings,
  type SessionSpecBase,
} from "./office-options.ts";
import { RecordedSession, type SessionHook } from "./recorded-session.ts";
import type { Sandbox } from "./sandbox.ts";
import { claudeCodeSessionEnvironment } from "./session-environment.ts";

export type ProbeHook = SessionHook<ProbeSession>;

export interface SessionSpec extends SessionSpecBase<ProbeSession> {
  /** Last-word overrides for what a check varies on purpose. */
  readonly options?: Partial<Options>;
}

/**
 * One long-lived streaming `query()` started with the options the Office ships (spec §5.6, §6),
 * recording every stream message and hook call so a check can observe the engine.
 */
export class ProbeSession extends RecordedSession {
  private readonly input = new InputChannel<SDKUserMessage>();
  private readonly engine: Query;
  private readonly consumed: Promise<void>;

  private constructor(
    sessionId: string,
    pluginFolder: string,
    spec: SessionSpec,
    signal: AbortSignal,
  ) {
    super(sessionId, spec.repository, pluginFolder, signal);
    this.engine = query({ prompt: this.input, options: this.buildOptions(spec) });
    this.consumed = this.consume();
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

  async stopTask(taskId: string): Promise<void> {
    await this.engine.stopTask(taskId);
  }

  async close(): Promise<void> {
    this.input.close();
    this.engine.close();
    await this.consumed;
  }

  protected deliver(message: SDKUserMessage): void {
    this.input.push(message);
  }

  private buildOptions(spec: SessionSpec): Options {
    const abortController = new AbortController();
    this.signal.addEventListener("abort", () => abortController.abort(this.signal.reason), {
      once: true,
    });
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
      skills: allowedSkillNames(spec),
      settings: sessionSettings(spec.repository, spec.settings),
      permissionPrompts: "none",
      systemPrompt: { type: "preset", preset: "claude_code", excludeDynamicSections: true },
      env: claudeCodeSessionEnvironment(),
      hooks: this.hookMatchers(spec.hooks ?? {}),
      abortController,
      stderr: (chunk) => this.recordStderr(chunk),
      ...(spec.resume === undefined ? { sessionId: this.sessionId } : { resume: spec.resume }),
      ...spec.options,
    };
  }

  private hookMatchers(
    hooks: Partial<Record<HookEvent, ProbeHook>>,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return Object.fromEntries(
      hookEvents(hooks).map((event) => {
        const decide = hooks[event];
        return [
          event,
          [
            {
              hooks: [
                (input: HookInput, toolUseId: string | undefined): Promise<HookJSONOutput> =>
                  this.recordHookCall(
                    event,
                    toolUseId,
                    input,
                    decide === undefined ? undefined : (hookInput) => decide(hookInput, this),
                  ),
              ],
            },
          ],
        ];
      }),
    );
  }

  private async consume(): Promise<void> {
    try {
      for await (const message of this.engine) {
        this.record(message);
      }
      this.finish();
    } catch (error) {
      this.finish(error);
    }
  }
}
