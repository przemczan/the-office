import {
  answer,
  copilotEvent,
  idle,
  toolDenied,
  toolDone,
  toolStart,
  usage,
  userMessage,
} from "./copilot-events.fixtures.js";
import type {
  CopilotEvent,
  CopilotListedSkill,
  CopilotMessage,
  CopilotRuntimeSession,
  CopilotSessionHandlers,
  CopilotSessionSpec,
  CopilotToolDecision,
  OpenCopilotSession,
} from "./copilot-runtime.js";

/** One thing a stand-in turn does, in order. */
export type StandInStep =
  | {
      readonly kind: "tool";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly args: unknown;
      /** What the call does once the hook allowed it, such as writing a file; its words. */
      readonly run?: () => Promise<string> | string;
    }
  | { readonly kind: "answer"; readonly content: string }
  /** Holds the turn until `until` settles or the turn is aborted, as a long command does. */
  | { readonly kind: "wait"; readonly until: Promise<void> };

/** A tool call the stand-in asked the hook about, with its answer. */
export interface HookedCall {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly decision: CopilotToolDecision;
}

/**
 * A Copilot CLI runtime for tests, in the service's process: it calls the session's handlers as
 * the runtime does (docs/engine-check.md, `copilot.*`). A message sent while no turn runs starts
 * the next of `turns`; one sent `immediate` while a turn runs lands at once, one sent `enqueue`
 * at the turn's end, before its one `session.idle`. Each tool call emits `tool.execution_start`,
 * then asks the hook, and runs only when allowed, else ends `denied` with the hook's reason.
 */
export class StandInCopilotRuntime {
  readonly specs: CopilotSessionSpec[] = [];
  readonly sent: CopilotMessage[] = [];
  readonly hooked: HookedCall[] = [];
  /** What the runtime lists as loaded skills. */
  skills: CopilotListedSkill[] = [];
  /** Each turn's steps, the next taken as a turn starts; a turn with none just answers. */
  turns: StandInStep[][] = [];
  aborts = 0;
  closes = 0;
  /** Set to make `open` fail, as a runtime that doesn't start. */
  openFailure: Error | undefined;
  private handlers: CopilotSessionHandlers | undefined;
  private running: Promise<void> | undefined;
  private queued: string[] = [];
  private abortTurn: (() => void) | undefined;
  private aborted = false;

  readonly open: OpenCopilotSession = (spec, handlers) => {
    this.specs.push(spec);
    if (this.openFailure !== undefined) return Promise.reject(this.openFailure);
    this.handlers = handlers;
    return Promise.resolve(this.session(spec.sessionId));
  };

  /** Asks the hook as the runtime would, outside any turn. */
  ask(toolName: string, toolCallId: string, toolArgs: unknown): Promise<CopilotToolDecision> {
    return this.on().preToolUse({ toolName, toolCallId, toolArgs, agentId: undefined });
  }

  /** Asks the permission handler as the runtime would. */
  permission(toolCallId: string | undefined): boolean {
    return this.on().permissionRequested(toolCallId);
  }

  emit(event: CopilotEvent): void {
    this.on().onEvent(event);
  }

  /** Ends the runtime by itself, as a crash does. */
  exit(words: string): void {
    this.on().runtimeExited(words);
  }

  /** Once the running turn, if any, has ended. */
  async settled(): Promise<void> {
    await this.running;
  }

  private on(): CopilotSessionHandlers {
    if (this.handlers === undefined) throw new Error("No session is open on the stand-in.");
    return this.handlers;
  }

  private session(sessionId: string): CopilotRuntimeSession {
    return {
      sessionId,
      send: (message) => {
        this.sent.push(message);
        this.received(message);
        return Promise.resolve();
      },
      abort: () => {
        this.aborts += 1;
        this.aborted = true;
        this.abortTurn?.();
        return Promise.resolve();
      },
      listSkills: () => Promise.resolve(this.skills),
      close: async () => {
        this.closes += 1;
        this.aborted = true;
        this.abortTurn?.();
        await this.running;
      },
    };
  }

  private received(message: CopilotMessage): void {
    if (this.running === undefined) {
      const running = this.turn(message.clientTurnId);
      this.running = running;
      void running.finally(() => {
        if (this.running === running) this.running = undefined;
      });
    } else if (message.mode === "immediate") {
      this.emit(userMessage(message.clientTurnId));
    } else {
      this.queued.push(message.clientTurnId);
    }
  }

  private async turn(clientTurnId: string): Promise<void> {
    this.aborted = false;
    const abortedNow = new Promise<void>((resolve) => (this.abortTurn = resolve));
    await Promise.resolve();
    this.emit(userMessage(clientTurnId));
    for (const step of this.turns.shift() ?? [{ kind: "answer", content: "Done." }]) {
      if (this.aborted) break;
      await this.step(step, abortedNow);
    }
    if (this.aborted) {
      this.emit(copilotEvent("abort", { reason: "user_initiated" }));
    } else {
      for (const queued of this.queued.splice(0)) this.emit(userMessage(queued));
      this.emit(answer("All done."));
    }
    this.emit(usage(100, 10));
    this.emit(copilotEvent("session.usage_info", { currentTokens: 110, tokenLimit: 128_000 }));
    // A message sent once the turn is idle starts the next turn.
    this.running = undefined;
    this.emit(idle(this.aborted ? true : undefined));
  }

  private async step(step: StandInStep, abortedNow: Promise<void>): Promise<void> {
    switch (step.kind) {
      case "answer":
        this.emit(answer(step.content));
        return;
      case "wait":
        await Promise.race([step.until, abortedNow]);
        return;
      case "tool": {
        this.emit(toolStart(step.toolCallId, step.toolName, step.args));
        const decision = await this.ask(step.toolName, step.toolCallId, step.args);
        this.hooked.push({ toolName: step.toolName, toolCallId: step.toolCallId, decision });
        if (decision.allowed) {
          this.emit(toolDone(step.toolCallId, (await step.run?.()) ?? "ok"));
        } else {
          this.emit(toolDenied(step.toolCallId, decision.reason));
        }
      }
    }
  }
}
