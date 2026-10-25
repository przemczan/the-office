import { Inject, Injectable } from "@nestjs/common";
import { RoleCards } from "../../people/index.js";
import {
  decideContext,
  type ContextDecision,
  type ContextPolicySettings,
} from "../domain/context-policy.js";
import type { Thread } from "../domain/thread.js";
import { Briefs } from "./briefs.js";

/**
 * The Context policy's settings: an hour's cache and 30k to start with, until Settings holds the
 * threshold (task 17).
 */
export const CONTEXT_POLICY_SETTINGS = Symbol("ContextPolicySettings");

/** What a Thread's next message would do to its session now, for its label (spec §2.5). */
@Injectable()
export class ThreadContexts {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly briefs: Briefs,
    @Inject(CONTEXT_POLICY_SETTINGS) private readonly settings: ContextPolicySettings,
  ) {}

  async of(thread: Thread, now: Date = new Date()): Promise<ContextDecision> {
    const role = await this.roleCards.find(thread.roleKey);
    const brief = await this.briefs.forChatThread(thread);
    return decideContext(
      {
        now,
        session: thread.session,
        roleKey: thread.roleKey,
        // Nobody fills the Role any more: its Threads stay readable, and nobody answers.
        sessionDefault: role?.card.sessionDefault ?? "context-policy",
        override: thread.override,
        briefTokens: brief.tokens,
      },
      this.settings,
    );
  }
}
