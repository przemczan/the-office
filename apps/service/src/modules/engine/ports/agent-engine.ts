import type { Engine } from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import type { EngineSession, UserMessage } from "./engine-session.js";
import type { TokenUsage } from "./session-events.js";
import type { SessionOptions } from "./session-options.js";

/** What an engine can do beyond starting a session and taking messages; The Office degrades where one is missing. */
export interface EngineCapabilities {
  /** A message sent with priority `next` lands in the running turn between tool calls, not after it. */
  readonly bargeIn: boolean;
  /** A running turn can be stopped, a running command with it. */
  readonly interrupt: boolean;
  /** An ended session can be resumed by its id. */
  readonly resume: boolean;
  /** A session reads the account's usage windows. */
  readonly usageWindows: boolean;
  /** A session reads how full its context is. */
  readonly contextUsage: boolean;
  /** Sessions run Office tools. */
  readonly officeTools: boolean;
  /** A turn's output can be held to a JSON Schema. */
  readonly outputSchema: boolean;
  /** Sessions have the LSP tool, on the workstation's language servers. */
  readonly languageServers: boolean;
  /**
   * An ended session can be carried over to another engine of the same kind, to resume there, as
   * a Stand-in Engine takes over a Stage whose engine's usage window is used up.
   */
  readonly carrySession: boolean;
  /** It starts its account's 5-hour window with one small turn that keeps no session (spec §5.4.6). */
  readonly startsUsageWindow: boolean;
}

export type EngineCapability = keyof EngineCapabilities;

/** What `capabilities` lack, in the order they are declared. */
export function missingCapabilities(capabilities: EngineCapabilities): readonly EngineCapability[] {
  // An engine's capabilities object holds exactly the interface's keys.
  const declared = Object.keys(capabilities) as EngineCapability[];
  return declared.filter((capability) => !capabilities[capability]);
}

/** Asked of an engine for something it declares it can't do. */
export class CapabilityMissing extends Error {
  constructor(readonly capability: EngineCapability) {
    super(`The engine has no ${capability} capability.`);
    this.name = "CapabilityMissing";
  }
}

/**
 * A session that would not have exactly its skills (spec §5.6): refused before its first turn,
 * or ended when the engine says so only as the turn begins.
 */
export class SessionSkillsDiffer extends Error {
  constructor(
    readonly sessionId: string,
    readonly problems: readonly string[],
  ) {
    super(`Session ${sessionId} doesn't have exactly its skills. ${problems.join(" ")}`);
    this.name = "SessionSkillsDiffer";
  }
}

/**
 * A session whose model the engine doesn't offer now, such as a Role card naming an API endpoint
 * removed from Settings › Engines since: refused before its first turn, in words saying why.
 */
export class ModelNotOffered extends Error {
  constructor(
    readonly model: string,
    reason: string,
  ) {
    super(`The model ${model} isn't offered: ${reason}`);
    this.name = "ModelNotOffered";
  }
}

/**
 * A session on an engine Settings › Engines no longer lists: refused before it starts, in words
 * saying why.
 */
export class EngineNotListed extends Error {
  constructor(readonly engineId: string) {
    super(`Settings › Engines lists no engine ${engineId}; pick another engine on the Role card.`);
    this.name = "EngineNotListed";
  }
}

/** No session starts while Settings › Engines lists no engine, the only one removed (spec §5.4). */
export class NoEngineListed extends Error {
  constructor() {
    super("Settings › Engines lists no engine, so no session starts; add one there first.");
    this.name = "NoEngineListed";
  }
}

/** A session to carry over that the engine it ran on holds no transcript of. */
export class SessionNotCarried extends Error {
  constructor(
    readonly sessionId: string,
    readonly engineId: string,
  ) {
    super(`Engine ${engineId} holds no session ${sessionId} to carry over.`);
    this.name = "SessionNotCarried";
  }
}

/** How long an engine-level read, such as `readUsageWindows`, may take before it is ended. */
export const ENGINE_READ_TIMEOUT_MS = 30_000;

/** An engine-level read took longer than `ENGINE_READ_TIMEOUT_MS`; its process or query was ended. */
export class EngineReadTimedOut extends Error {
  constructor(what: string) {
    super(`${what} took longer than ${ENGINE_READ_TIMEOUT_MS / 1000} seconds and was ended.`);
    this.name = "EngineReadTimedOut";
  }
}

/** The turn that started an engine's 5-hour window: its tokens and the model it ran on. */
export interface UsageWindowStart {
  readonly tokens: TokenUsage;
  readonly model: string;
}

export interface NewSession {
  /** Chosen by the caller, so what is named after the session, such as its skills folder, exists before it starts. */
  readonly id: string;
  readonly options: SessionOptions;
  /** The first message, which starts the first turn. */
  readonly brief: UserMessage;
}

/**
 * Runs Agents' sessions (spec §5.4). Not shaped after any one engine: each adapter declares its
 * capabilities and refuses with `CapabilityMissing` what it can't do.
 */
export abstract class AgentEngine {
  abstract readonly capabilities: EngineCapabilities;

  /**
   * Office tools need the `officeTools` capability, an output schema the `outputSchema` one.
   * Throws `SessionSkillsDiffer`, before the brief starts a turn, when the session would not list
   * exactly its skills.
   */
  abstract start(session: NewSession): Promise<EngineSession>;

  /**
   * Continues an ended session with its conversation, under the options it started with. It waits
   * for a message. Needs the `resume` capability; throws `SessionSkillsDiffer` as `start` does.
   */
  abstract resume(sessionId: string, options: SessionOptions): Promise<EngineSession>;

  /**
   * Reads the usage windows of `engine`'s account with no session and no model call, so they are
   * read while nothing runs on it (spec §5.4). Undefined without the `usageWindows` capability or
   * for an account without windows. Whatever process or query it opens ends before it answers, on
   * failure too, and within `ENGINE_READ_TIMEOUT_MS`, after which it throws `EngineReadTimedOut`;
   * `signal` ends it sooner, as the service stops, throwing its reason.
   */
  abstract readUsageWindows(engine: Engine, signal: AbortSignal): Promise<UsageWindows | undefined>;

  /**
   * The models `engine`'s account offers now, by the ids a session names them by (spec §5.4.5,
   * "Models an engine lists"), with no session and no model call. Undefined when the engine type
   * has no list to ask for, or the account answered none, so its kept or fixed list stands. As
   * `readUsageWindows`, whatever it opens ends before it answers, within `ENGINE_READ_TIMEOUT_MS`
   * (`EngineReadTimedOut`), or sooner on `signal`.
   */
  listModels(engine: Engine, signal: AbortSignal): Promise<readonly string[] | undefined> {
    void engine;
    void signal;
    // An engine whose accounts list their models overrides this.
    return Promise.resolve(undefined);
  }

  /**
   * Carries the ended session `sessionId` over from engine `from` to engine `to`, so `to` resumes
   * it with its conversation. Idempotent, and `from`'s copy is left as it was. Needs the
   * `carrySession` capability; throws `SessionNotCarried` when `from` holds no such session.
   */
  carrySession(sessionId: string, from: Engine, to: Engine): Promise<void> {
    void sessionId;
    void from;
    void to;
    this.require("carrySession");
    // An engine declaring the capability overrides this.
    return Promise.reject(new CapabilityMissing("carrySession"));
  }

  /**
   * Starts `engine`'s 5-hour window (spec §5.4.6, "Starting the 5-hour window"): one turn with a
   * one-line prompt on the engine type's cheapest model, no tools, keeping no session, transcript
   * or thread. Needs the `startsUsageWindow` capability. Whatever process or query it opens ends
   * before it answers, on failure too, and within `ENGINE_READ_TIMEOUT_MS`, after which it throws
   * `EngineReadTimedOut`; `signal` ends it sooner, as the service stops, throwing its reason.
   */
  startUsageWindow(engine: Engine, signal: AbortSignal): Promise<UsageWindowStart> {
    void engine;
    void signal;
    this.require("startsUsageWindow");
    // An engine declaring the capability overrides this.
    return Promise.reject(new CapabilityMissing("startsUsageWindow"));
  }

  /** Throws `CapabilityMissing` unless the engine has `capability`. */
  protected require(capability: EngineCapability): void {
    if (!this.capabilities[capability]) throw new CapabilityMissing(capability);
  }

  /** Throws `CapabilityMissing` unless the engine has every capability `options` need. */
  protected requireFor(options: SessionOptions): void {
    if (options.officeTools.length > 0) this.require("officeTools");
    if (options.outputSchema !== undefined) this.require("outputSchema");
  }
}
