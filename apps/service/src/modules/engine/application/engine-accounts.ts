import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { EngineAccount } from "../domain/engine-account.js";
import { EngineAccountChanged } from "../domain/engine-events.js";
import type { EngineId } from "../domain/engines.js";
import { ClaudeCodeAccounts } from "../ports/claude-code-accounts.js";
import { EngineModels } from "./engine-models.js";

/** Settings › Engines names no Claude Code engine by that id. */
export class NotAClaudeCodeEngine extends Error {
  constructor(readonly engineId: EngineId) {
    super("Settings › Engines lists no Claude Code engine by that id.");
  }
}

/**
 * Each Claude Code engine's account (spec §5.4): its status, and Sign in, whose end is announced
 * as `EngineAccountChanged`.
 */
@Injectable()
export class EngineAccounts {
  private readonly logger = new Logger(EngineAccounts.name);

  constructor(
    private readonly accounts: ClaudeCodeAccounts,
    private readonly engineModels: EngineModels,
    private readonly events: EventBus,
  ) {}

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

  private async requireClaudeCode(engineId: EngineId): Promise<void> {
    const engine = await this.engineModels.find(engineId);
    if (engine?.kind !== "claude-code") throw new NotAClaudeCodeEngine(engineId);
  }

  /** Nobody waits on a Sign in's end, so a failure to announce it is logged. */
  private async announce(engineId: EngineId): Promise<void> {
    try {
      await this.events.publish(new EngineAccountChanged(engineId));
    } catch (error) {
      this.logger.error(
        `Announcing the account of ${engineId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
