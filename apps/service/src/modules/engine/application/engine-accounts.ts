import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { EngineAccount } from "../domain/engine-account.js";
import { EngineAccountChanged, EngineAdded, EngineRemoved } from "../domain/engine-events.js";
import type { EngineId } from "../domain/engines.js";
import type { PastedToken } from "../domain/pasted-token.js";
import { ClaudeCodeAccounts } from "../ports/claude-code-accounts.js";
import { EngineModels } from "./engine-models.js";
import { RunningEngineSessions } from "./running-engine-sessions.js";

/** Settings › Engines names no Claude Code engine by that id. */
export class NotAClaudeCodeEngine extends Error {
  constructor(readonly engineId: EngineId) {
    super("Settings › Engines lists no Claude Code engine by that id.");
  }
}

/**
 * Each Claude Code engine's account (spec §5.4): its status, Sign in, a pasted token and Sign out,
 * each change announced as `EngineAccountChanged`. The account lies in the engine's config folder, made when the engine
 * is added and removed once the sessions running on it have ended.
 */
@Injectable()
export class EngineAccounts implements OnModuleInit {
  private readonly logger = new Logger(EngineAccounts.name);

  constructor(
    private readonly accounts: ClaudeCodeAccounts,
    private readonly engineModels: EngineModels,
    private readonly events: EventBus,
    private readonly runningSessions: RunningEngineSessions,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(EngineAdded, async ({ engineId, kind }) => {
      if (kind === "claude-code") await this.accounts.prepareConfigFolder(engineId);
    });
    this.events.subscribe(EngineRemoved, ({ engineId, kind }) => {
      // Not awaited: the removal is done, and its sessions may run for minutes yet.
      if (kind === "claude-code") void this.removeFolderAfterSessions(engineId);
    });
  }

  /**
   * Removes the removed engine's folder once no session runs on it, as a running session finishes
   * on the old engine. An engine added again meanwhile under its name has taken its id back
   * (`engineIdFor`), and the folder with it.
   */
  private async removeFolderAfterSessions(engineId: EngineId): Promise<void> {
    try {
      await this.runningSessions.allEnded(engineId);
      if (await this.engineModels.find(engineId)) return;
      await this.accounts.removeConfigFolder(engineId);
    } catch (error) {
      this.logger.error(
        `Removing the folder of the removed engine ${engineId} failed: ${messageOf(error)}`,
      );
    }
  }

  async account(engineId: EngineId): Promise<EngineAccount> {
    await this.requireClaudeCode(engineId);
    return this.accounts.account(engineId);
  }

  /** Starts a Sign in on the engine, giving the page that signs in by a pasted code. */
  async signIn(engineId: EngineId): Promise<string> {
    await this.requireClaudeCode(engineId);
    const { url, ended } = await this.accounts.signIn(engineId);
    void ended.then(() => this.announce(engineId));
    return url;
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

  async signOut(engineId: EngineId): Promise<void> {
    await this.requireClaudeCode(engineId);
    await this.accounts.signOut(engineId);
    await this.announce(engineId);
  }

  private async requireClaudeCode(engineId: EngineId): Promise<void> {
    const engine = await this.engineModels.find(engineId);
    if (engine?.kind !== "claude-code") throw new NotAClaudeCodeEngine(engineId);
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
