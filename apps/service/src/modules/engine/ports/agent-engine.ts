import type { EngineSession, UserMessage } from "./engine-session.js";
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
  /** Sessions run Office tools. */
  readonly officeTools: boolean;
  /** A turn's output can be held to a JSON Schema. */
  readonly outputSchema: boolean;
}

export type EngineCapability = keyof EngineCapabilities;

/** Asked of an engine for something it declares it can't do. */
export class CapabilityMissing extends Error {
  constructor(readonly capability: EngineCapability) {
    super(`The engine has no ${capability} capability.`);
    this.name = "CapabilityMissing";
  }
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

  /** Office tools need the `officeTools` capability, an output schema the `outputSchema` one. */
  abstract start(session: NewSession): Promise<EngineSession>;

  /**
   * Continues an ended session with its conversation, under the options it started with. It waits
   * for a message. Needs the `resume` capability.
   */
  abstract resume(sessionId: string, options: SessionOptions): Promise<EngineSession>;

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
