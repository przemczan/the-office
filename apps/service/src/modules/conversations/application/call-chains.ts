import { Injectable } from "@nestjs/common";
import { callChain, type CallChain } from "../domain/consult.js";
import type { Decision } from "../domain/decision.js";
import type { Thread } from "../domain/thread.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/**
 * Reads chains of calls (spec §2.2) up the Consultations' `askerThreadId` links, for the pure rules
 * in `domain/consult.ts` to judge.
 */
@Injectable()
export class CallChains {
  constructor(private readonly repository: ThreadRepository) {}

  /** The chain a call made from the Thread would join, by its person. */
  async ofCaller(thread: Thread): Promise<CallChain> {
    return callChain(thread.session?.roleKey ?? thread.roleKey, await this.above(thread));
  }

  /** The chain the Decision is in, to pass it on down. */
  async ofDecision(decision: Decision): Promise<CallChain> {
    const asker = await this.repository.find(decision.threadId);
    return callChain(decision.roleKey, [decision, ...(asker ? await this.above(asker) : [])]);
  }

  /**
   * The Decisions the Thread answers, its Consultation's first, then up the askers' Consultations;
   * none for a Thread that is no Consultation. A link that is gone ends the walk.
   */
  private async above(thread: Thread): Promise<readonly Decision[]> {
    const decisions: Decision[] = [];
    const seen = new Set<string>([thread.id]);
    let consultation = thread.consultation;
    while (consultation) {
      const decision = await this.repository.decision(consultation.decisionId);
      if (!decision) break;
      decisions.push(decision);
      if (seen.has(consultation.askerThreadId)) break;
      seen.add(consultation.askerThreadId);
      consultation = (await this.repository.find(consultation.askerThreadId))?.consultation;
    }
    return decisions;
  }
}
