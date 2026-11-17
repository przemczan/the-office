import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { EngineId, EngineKind } from "./engines.js";
import type { UsageWindowName, UsageWindows } from "./usage-windows.js";

/**
 * An engine's account's usage windows changed, as read after the engine signalled a rate limit
 * (spec §5.4). Each Claude Code engine and Codex engine is an account of its own, so it names the
 * engine, with its name at the time for the words.
 */
export class UsageWindowsChanged extends DomainEvent {
  constructor(
    readonly engineId: EngineId,
    readonly engineName: string,
    readonly windows: UsageWindows,
  ) {
    super();
  }
}

/**
 * An engine refused a turn because one of its account's usage windows is used up (spec 5.4):
 * announced once per engine until `resetsAt`, or again when a later refusal moves the reset on.
 */
export class UsageWindowUsedUp extends DomainEvent {
  constructor(
    readonly engineId: EngineId,
    readonly engineName: string,
    readonly window: UsageWindowName,
    readonly resetsAt: Date,
  ) {
    super();
  }
}

/** The used-up window of `engineId`'s account reached its reset: its turns may run again. */
export class UsageWindowReset extends DomainEvent {
  constructor(
    readonly engineId: EngineId,
    readonly window: UsageWindowName,
  ) {
    super();
  }
}

/**
 * An engine's account's usage windows were read, changed or not: each reading tells what The Office
 * used of them since, so what was expected of the Starts before it on that engine is known now
 * (spec §2.1).
 */
export class UsageWindowsRead extends DomainEvent {
  constructor(
    readonly engineId: EngineId,
    readonly windows: UsageWindows,
    readonly readAt: Date,
  ) {
    super();
  }
}

/**
 * Settings › Engines added an engine, so a Claude Code engine's config folder is made. It carries
 * no more than the id and kind: an API engine's key never travels in an event.
 */
export class EngineAdded extends DomainEvent {
  constructor(
    readonly engineId: EngineId,
    readonly kind: EngineKind,
  ) {
    super();
  }
}

/** Settings › Engines removed an engine, so a Claude Code engine's config folder goes with it. */
export class EngineRemoved extends DomainEvent {
  constructor(
    readonly engineId: EngineId,
    readonly kind: EngineKind,
  ) {
    super();
  }
}

/**
 * A Sign in of a Claude Code or Codex engine ended, signed in or not, or a token was pasted, an API
 * key set or a Sign out made, so its account may differ now (spec §5.4).
 */
export class EngineAccountChanged extends DomainEvent {
  constructor(readonly engineId: EngineId) {
    super();
  }
}

/**
 * A session's Agent, or one of its subagents, called the Skill tool, on any engine, so its owner
 * can count a Skill use (spec §2.6). `skill` is as the call names it, without a leading `/`.
 */
export class SkillCalled extends DomainEvent {
  constructor(
    readonly sessionId: string,
    readonly engineId: EngineId,
    readonly skill: string,
    readonly calledAt: Date,
  ) {
    super();
  }
}

/** The engine could not start a session, or stopped running one: its program didn't start or its stream died. */
export class EngineDown extends DomainEvent {
  constructor(
    readonly sessionId: string,
    readonly engineId: EngineId,
    /** The engine's name in Settings › Engines as the session opened. */
    readonly engineName: string,
    /** In the engine's words. */
    readonly reason: string,
  ) {
    super();
  }
}
