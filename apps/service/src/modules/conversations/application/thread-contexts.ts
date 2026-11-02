import { Injectable } from "@nestjs/common";
import { EngineCascade, RoleCards } from "../../people/index.js";
import { decideContext, type ContextDecision } from "../domain/context-policy.js";
import type { Thread } from "../domain/thread.js";
import { Briefs } from "./briefs.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";

/**
 * What a Thread's next message would do to its session now, for its label (spec §2.5). The engine
 * comes from the cascade's Office levels: the Thread's Project isn't read here yet.
 */
@Injectable()
export class ThreadContexts {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly engineCascade: EngineCascade,
    private readonly briefs: Briefs,
    private readonly settings: ContextPolicySettingsService,
  ) {}

  async of(thread: Thread, now: Date = new Date()): Promise<ContextDecision> {
    const [role, brief, settings] = await Promise.all([
      this.roleCards.find(thread.roleKey),
      this.briefs.forThread(thread),
      this.settings.current(),
    ]);
    // Nobody fills the Role any more: its Threads stay readable, and nobody answers.
    const applying = role && (await this.engineCascade.of(thread.roleKey));
    return decideContext(
      {
        now,
        session: thread.session,
        roleKey: thread.roleKey,
        sessionDefault: role?.card.sessionDefault ?? "context-policy",
        engineId: applying?.engineId,
        override: thread.override,
        briefTokens: brief.tokens,
      },
      settings,
    );
  }
}
