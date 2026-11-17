import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { CodexApiKey } from "../domain/codex-api-key.js";
import { CODEX_API_KEY_ACCOUNT, type EngineAccount } from "../domain/engine-account.js";
import { EngineAccountChanged, EngineAdded, EngineRemoved } from "../domain/engine-events.js";
import type { CodexEngine, Engine, EngineId, EngineKind } from "../domain/engines.js";
import type { PastedToken } from "../domain/pasted-token.js";
import { ClaudeCodeAccounts } from "../ports/claude-code-accounts.js";
import { CodexAccounts } from "../ports/codex-accounts.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";
import { EngineModels } from "./engine-models.js";
import { EngineReferenceLock } from "./engine-reference-lock.js";
import { RunningEngineSessions } from "./running-engine-sessions.js";

/** Settings › Engines names no Claude Code engine by that id, for what only one of those takes. */
export class NotAClaudeCodeEngine extends Error {
  constructor(readonly engineId: EngineId) {
    super("Settings › Engines lists no Claude Code engine by that id.");
  }
}

/** Settings › Engines names no Codex engine by that id, for what only one of those takes. */
export class NotACodexEngine extends Error {
  constructor(readonly engineId: EngineId) {
    super("Settings › Engines lists no Codex engine by that id.");
  }
}

/** Settings › Engines names no engine with an account by that id: none, or an API engine. */
export class NotAnEngineWithAnAccount extends Error {
  constructor(readonly engineId: EngineId) {
    super("Settings › Engines lists no Claude Code or Codex engine by that id.");
  }
}

/** The kinds of engine that sign in in a folder of their own, `<office-data>/engines/<id>/`. */
const KINDS_WITH_A_FOLDER: ReadonlySet<EngineKind> = new Set(["claude-code", "codex"]);

/** A Sign in started: its page, and the one-time code a Codex engine's page asks for. */
export interface StartedSignIn {
  readonly url: string;
  readonly userCode?: string;
}

/**
 * Each Claude Code and Codex engine's account (spec §5.4): its status, Sign in and Sign out, a
 * pasted token on a Claude Code engine and an API key on a Codex engine, each change announced as
 * `EngineAccountChanged`. The account lies in the engine's folder, made when the engine is added
 * and removed once the sessions running on it have ended; a Codex engine's API key is kept in the
 * database too, and never logged, announced or answered back.
 */
@Injectable()
export class EngineAccounts implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(EngineAccounts.name);

  constructor(
    private readonly accounts: ClaudeCodeAccounts,
    private readonly codexAccounts: CodexAccounts,
    private readonly engineModels: EngineModels,
    private readonly settings: EngineSettingsRepository,
    private readonly lock: EngineReferenceLock,
    private readonly events: EventBus,
    private readonly runningSessions: RunningEngineSessions,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(EngineAdded, async ({ engineId, kind }) => {
      if (kind === "claude-code") await this.accounts.prepareConfigFolder(engineId);
      if (kind === "codex") await this.codexAccounts.prepareHome(engineId);
    });
    this.events.subscribe(EngineRemoved, ({ engineId, kind }) => {
      // Not awaited: the removal is done, and its sessions may run for minutes yet.
      if (KINDS_WITH_A_FOLDER.has(kind)) void this.removeFolderAfterSessions(engineId, kind);
    });
  }

  /**
   * Removes the folder of every engine no longer listed: one removed while the service stopped
   * before its sessions ended, which an engine added again under its name would otherwise take
   * back, its login included. An API engine listed under a removed one's id has no folder of its own.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const listed = new Set(
        (await this.engineModels.engines())
          .filter(({ kind }) => KINDS_WITH_A_FOLDER.has(kind))
          .map(({ id }) => id),
      );
      // Both kinds' folders lie in the same `engines/` folder, so each adapter may name them all.
      for (const engineId of await this.accounts.engineIdsWithConfigFolders()) {
        if (!listed.has(engineId)) await this.accounts.removeConfigFolder(engineId);
      }
      for (const engineId of await this.codexAccounts.engineIdsWithHomes()) {
        if (!listed.has(engineId)) await this.codexAccounts.removeHome(engineId);
      }
    } catch (error) {
      this.logger.error(`Removing the folders of removed engines failed: ${messageOf(error)}`);
    }
  }

  /**
   * Removes the removed engine's folder once no session runs on it, as a running session finishes
   * on the old engine. An engine with a folder added again meanwhile under its name has taken its
   * id back (`engineIdFor`), and the folder with it; an API engine has no use for it.
   */
  private async removeFolderAfterSessions(engineId: EngineId, kind: EngineKind): Promise<void> {
    try {
      await this.runningSessions.allEnded(engineId);
      const listed = await this.engineModels.find(engineId);
      if (listed !== undefined && KINDS_WITH_A_FOLDER.has(listed.kind)) return;
      if (kind === "codex") await this.codexAccounts.removeHome(engineId);
      else await this.accounts.removeConfigFolder(engineId);
    } catch (error) {
      this.logger.error(
        `Removing the folder of the removed engine ${engineId} failed: ${messageOf(error)}`,
      );
    }
  }

  /** The account; a Codex engine with an API key kept is signed in by it. */
  async account(engineId: EngineId): Promise<EngineAccount> {
    const engine = await this.requireAccount(engineId);
    if (engine.kind === "claude-code") return this.accounts.account(engineId);
    if (engine.apiKey !== null) return CODEX_API_KEY_ACCOUNT;
    return this.codexAccounts.account(engineId);
  }

  /**
   * Starts a Sign in on the engine: on a Claude Code engine the page that signs in by a pasted
   * code; on a Codex engine the device page and its one-time code, in place of any API key kept.
   * Its end is announced.
   */
  async signIn(engineId: EngineId): Promise<StartedSignIn> {
    const engine = await this.requireAccount(engineId);
    if (engine.kind === "claude-code") {
      const { url, ended } = await this.accounts.signIn(engineId);
      void ended.then(() => this.announce(engineId));
      return { url };
    }
    await this.forgetApiKey(engine);
    const { url, userCode, ended } = await this.codexAccounts.signIn(engineId);
    void ended.then(() => this.announce(engineId));
    return { url, userCode };
  }

  async enterCode(engineId: EngineId, code: string): Promise<void> {
    await this.requireClaudeCode(engineId);
    await this.accounts.enterCode(engineId, code);
  }

  /** Signs the engine in by a token the user pasted, never kept anywhere but its folder. */
  async setPastedToken(engineId: EngineId, token: PastedToken): Promise<void> {
    await this.requireClaudeCode(engineId);
    await this.accounts.setPastedToken(engineId, token);
    await this.announce(engineId);
  }

  /**
   * Signs a Codex engine in by an OpenAI API key ("Use an API key instead"), in place of any
   * ChatGPT sign-in: its folder signed in with it, then the key kept in the database.
   */
  async setApiKey(engineId: EngineId, key: CodexApiKey): Promise<void> {
    const engine = await this.engineModels.find(engineId);
    if (engine?.kind !== "codex") throw new NotACodexEngine(engineId);
    await this.codexAccounts.setApiKey(engineId, key);
    await this.keepApiKey(engineId, key);
    await this.announce(engineId);
  }

  async signOut(engineId: EngineId): Promise<void> {
    const engine = await this.requireAccount(engineId);
    if (engine.kind === "claude-code") {
      await this.accounts.signOut(engineId);
    } else {
      await this.forgetApiKey(engine);
      await this.codexAccounts.signOut(engineId);
    }
    await this.announce(engineId);
  }

  private async requireClaudeCode(engineId: EngineId): Promise<void> {
    const engine = await this.engineModels.find(engineId);
    if (engine?.kind !== "claude-code") throw new NotAClaudeCodeEngine(engineId);
  }

  private async requireAccount(
    engineId: EngineId,
  ): Promise<Exclude<Engine, { readonly kind: "openai-compatible-api" }>> {
    const engine = await this.engineModels.find(engineId);
    if (engine === undefined || engine.kind === "openai-compatible-api") {
      throw new NotAnEngineWithAnAccount(engineId);
    }
    return engine;
  }

  private async forgetApiKey(engine: CodexEngine): Promise<void> {
    if (engine.apiKey !== null) await this.keepApiKey(engine.id, null);
  }

  /**
   * Under the `EngineReferenceLock` a Save holds from its read to its write, as the Save writes
   * every engine back with the key it read and would otherwise undo this one.
   */
  private async keepApiKey(engineId: EngineId, key: CodexApiKey | null): Promise<void> {
    await this.lock.holding(() => this.settings.setCodexApiKey(engineId, key));
  }

  /**
   * The account has changed whether or not it is announced, so a failure to announce it is logged,
   * not answered.
   */
  private async announce(engineId: EngineId): Promise<void> {
    try {
      await this.events.publish(new EngineAccountChanged(engineId));
    } catch (error) {
      this.logger.error(`Announcing the account of ${engineId} failed: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
