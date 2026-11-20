import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { AnthropicApiKey } from "../domain/anthropic-api-key.js";
import { CodexApiKey } from "../domain/codex-api-key.js";
import { CopilotCliToken } from "../domain/copilot-cli-token.js";
import {
  API_KEY_ACCOUNT,
  PASTED_TOKEN_ACCOUNT,
  type EngineAccount,
} from "../domain/engine-account.js";
import { EngineAccountChanged, EngineAdded, EngineRemoved } from "../domain/engine-events.js";
import type {
  CodexEngine,
  CopilotCliEngine,
  Engine,
  EngineId,
  EngineKind,
} from "../domain/engines.js";
import { PastedToken } from "../domain/pasted-token.js";
import { ClaudeCodeAccounts } from "../ports/claude-code-accounts.js";
import { CodexAccounts } from "../ports/codex-accounts.js";
import { CopilotCliAccounts } from "../ports/copilot-cli-accounts.js";
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

/**
 * Settings › Engines names no engine a token is pasted into by that id: none, or one that is
 * neither a Claude Code nor a Copilot CLI engine.
 */
export class NotAnEngineTakingAToken extends Error {
  constructor(readonly engineId: EngineId) {
    super("Settings › Engines lists no Claude Code or Copilot CLI engine by that id.");
  }
}

/** Settings › Engines names no engine an API key signs in by that id: neither Claude Code nor Codex. */
export class NotAnEngineWithAnApiKey extends Error {
  constructor(readonly engineId: EngineId) {
    super("Settings › Engines lists no Claude Code or Codex engine by that id.");
  }
}

/** Settings › Engines names no engine with an account by that id: none, or an API engine. */
export class NotAnEngineWithAnAccount extends Error {
  constructor(readonly engineId: EngineId) {
    super("Settings › Engines lists no Claude Code, Codex or Copilot CLI engine by that id.");
  }
}

/** The kinds of engine that sign in in a folder of their own, `<office-data>/engines/<id>/`. */
const KINDS_WITH_A_FOLDER: ReadonlySet<EngineKind> = new Set([
  "claude-code",
  "codex",
  "copilot-cli",
]);

/** A Sign in started: its page, and the one-time code a Codex or Copilot CLI engine's page asks for. */
export interface StartedSignIn {
  readonly url: string;
  readonly userCode?: string;
}

/**
 * Each Claude Code, Codex and Copilot CLI engine's account (spec §5.4): its status, Sign in and Sign
 * out, a pasted token on a Claude Code or Copilot CLI engine and an API key on a Claude Code or
 * Codex engine, each change announced as `EngineAccountChanged`. The account lies in the engine's
 * folder, made when the engine is added and removed once the sessions running on it have ended; a
 * Codex engine's API key and a Copilot CLI engine's token are kept in the database instead. No key
 * or token is ever logged, announced or answered back.
 */
@Injectable()
export class EngineAccounts implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(EngineAccounts.name);

  constructor(
    private readonly accounts: ClaudeCodeAccounts,
    private readonly codexAccounts: CodexAccounts,
    private readonly copilotCliAccounts: CopilotCliAccounts,
    private readonly engineModels: EngineModels,
    private readonly settings: EngineSettingsRepository,
    private readonly lock: EngineReferenceLock,
    private readonly events: EventBus,
    private readonly runningSessions: RunningEngineSessions,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(EngineAdded, async ({ engineId, kind }) => {
      if (kind === "claude-code") {
        await this.accounts.prepareConfigFolder(engineId);
        // An engine added again before its folder went takes back the key the folder holds.
        await this.recordApiKeySignIn(engineId);
      }
      if (kind === "codex") await this.codexAccounts.prepareHome(engineId);
      if (kind === "copilot-cli") await this.copilotCliAccounts.prepareHome(engineId);
    });
    this.events.subscribe(EngineRemoved, ({ engineId, kind }) => {
      this.engineModels.recordApiKeySignIn(engineId, false);
      // Not awaited: the removal is done, and its sessions may run for minutes yet.
      if (KINDS_WITH_A_FOLDER.has(kind)) void this.removeFolderAfterSessions(engineId, kind);
    });
  }

  /**
   * Records the Claude Code engines an API key signs in, then removes the folder of every engine no
   * longer listed: one removed while the service stopped before its sessions ended, which an engine
   * added again under its name would otherwise take back, its login included. An API engine listed
   * under a removed one's id has no folder of its own.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const engines = await this.engineModels.engines();
      for (const { id, kind } of engines) {
        if (kind === "claude-code") await this.recordApiKeySignIn(id);
      }
      const listed = new Set(
        engines.filter(({ kind }) => KINDS_WITH_A_FOLDER.has(kind)).map(({ id }) => id),
      );
      // Every kind's folders lie in the same `engines/` folder, so each adapter may name them all.
      for (const engineId of await this.accounts.engineIdsWithConfigFolders()) {
        if (!listed.has(engineId)) await this.accounts.removeConfigFolder(engineId);
      }
      for (const engineId of await this.codexAccounts.engineIdsWithHomes()) {
        if (!listed.has(engineId)) await this.codexAccounts.removeHome(engineId);
      }
      for (const engineId of await this.copilotCliAccounts.engineIdsWithHomes()) {
        if (!listed.has(engineId)) await this.copilotCliAccounts.removeHome(engineId);
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
      else if (kind === "copilot-cli") await this.copilotCliAccounts.removeHome(engineId);
      else await this.accounts.removeConfigFolder(engineId);
    } catch (error) {
      this.logger.error(
        `Removing the folder of the removed engine ${engineId} failed: ${messageOf(error)}`,
      );
    }
  }

  /**
   * The account; a Codex engine with an API key kept is signed in by it, and a Copilot CLI engine
   * with a token kept by that.
   */
  async account(engineId: EngineId): Promise<EngineAccount> {
    const engine = await this.requireAccount(engineId);
    switch (engine.kind) {
      case "claude-code":
        return this.accounts.account(engineId);
      case "codex":
        return engine.apiKey === null ? this.codexAccounts.account(engineId) : API_KEY_ACCOUNT;
      case "copilot-cli":
        return engine.token === null
          ? this.copilotCliAccounts.account(engineId)
          : PASTED_TOKEN_ACCOUNT;
    }
  }

  /**
   * Starts a Sign in on the engine: on a Claude Code engine the page that signs in by a pasted
   * code; on a Codex engine the device page and its one-time code, in place of any API key kept;
   * on a Copilot CLI engine GitHub's device page and its one-time code, in place of any token kept.
   * Its end is announced.
   */
  async signIn(engineId: EngineId): Promise<StartedSignIn> {
    const engine = await this.requireAccount(engineId);
    if (engine.kind === "claude-code") {
      const { url, ended } = await this.accounts.signIn(engineId);
      this.announceAfter(engineId, ended);
      return { url };
    }
    const { url, userCode, ended } =
      engine.kind === "codex"
        ? await this.forgetApiKey(engine).then(() => this.codexAccounts.signIn(engineId))
        : await this.forgetToken(engine).then(() => this.copilotCliAccounts.signIn(engineId));
    this.announceAfter(engineId, ended);
    return { url, userCode };
  }

  async enterCode(engineId: EngineId, code: string): Promise<void> {
    await this.requireClaudeCode(engineId);
    await this.accounts.enterCode(engineId, code);
  }

  /**
   * Signs the engine in by the token the user pasted as `text`, made a token, which reads as
   * redacted, before anything else is done with it: on a Claude Code engine one from `claude
   * setup-token`, kept nowhere but its folder; on a Copilot CLI engine a fine-grained personal access
   * token, kept in the database in place of the folder's sign-in, which is removed.
   */
  async setPastedToken(engineId: EngineId, text: string): Promise<void> {
    const engine = await this.engineModels.find(engineId);
    if (engine?.kind === "claude-code") {
      await this.accounts.setPastedToken(engineId, PastedToken.of(text));
    } else if (engine?.kind === "copilot-cli") {
      const token = CopilotCliToken.of(text);
      await this.copilotCliAccounts.signOut(engineId);
      await this.keepToken(engineId, token);
    } else {
      throw new NotAnEngineTakingAToken(engineId);
    }
    await this.announce(engineId);
  }

  /**
   * Signs the engine in by the API key given as `text`, in place of any login: a Claude Code engine
   * by an Anthropic API key ("Use an API key"), kept in its folder only; a Codex engine by an OpenAI
   * API key ("Use an API key instead"), its folder signed in with it, then the key kept in the
   * database. `text` is made a key, which reads as redacted, before anything else is done with it.
   */
  async setApiKey(engineId: EngineId, text: string): Promise<void> {
    const engine = await this.requireAccount(engineId);
    if (engine.kind === "copilot-cli") throw new NotAnEngineWithAnApiKey(engineId);
    if (engine.kind === "claude-code") {
      await this.accounts.setApiKey(engineId, AnthropicApiKey.of(text));
    } else {
      const key = CodexApiKey.of(text);
      await this.codexAccounts.setApiKey(engineId, key);
      await this.keepApiKey(engineId, key);
    }
    await this.announce(engineId);
  }

  async signOut(engineId: EngineId): Promise<void> {
    const engine = await this.requireAccount(engineId);
    switch (engine.kind) {
      case "claude-code":
        await this.accounts.signOut(engineId);
        break;
      case "codex":
        await this.forgetApiKey(engine);
        await this.codexAccounts.signOut(engineId);
        break;
      case "copilot-cli":
        await this.forgetToken(engine);
        await this.copilotCliAccounts.signOut(engineId);
        break;
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

  private async forgetToken(engine: CopilotCliEngine): Promise<void> {
    if (engine.token !== null) await this.keepToken(engine.id, null);
  }

  /** Under the `EngineReferenceLock`, as `keepApiKey` is. */
  private async keepToken(engineId: EngineId, token: CopilotCliToken | null): Promise<void> {
    await this.lock.holding(() => this.settings.setCopilotCliToken(engineId, token));
  }

  /** Announces the account once the Sign in has ended, however it ended. */
  private announceAfter(engineId: EngineId, ended: Promise<void>): void {
    void ended.then(
      () => this.announce(engineId),
      (error: unknown) => {
        this.logger.error(`The Sign in on ${engineId} ended badly: ${messageOf(error)}`);
        return this.announce(engineId);
      },
    );
  }

  private async recordApiKeySignIn(engineId: EngineId): Promise<void> {
    this.engineModels.recordApiKeySignIn(engineId, await this.accounts.signedInByApiKey(engineId));
  }

  /**
   * The account has changed whether or not it is announced, so a failure to announce it is logged,
   * not answered. Whether an API key signs a Claude Code engine in is recorded first, so the
   * handlers of the announcement list the engine as it is now.
   */
  private async announce(engineId: EngineId): Promise<void> {
    try {
      if ((await this.engineModels.find(engineId))?.kind === "claude-code") {
        await this.recordApiKeySignIn(engineId);
      }
      await this.events.publish(new EngineAccountChanged(engineId));
    } catch (error) {
      this.logger.error(`Announcing the account of ${engineId} failed: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
