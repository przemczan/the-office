import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import {
  changeToApply,
  type EditedHire,
  type OfficeSetting,
  type Proposal,
  type ProposedChange,
} from "../domain/proposal.js";
import { applyProposal, declineProposal, type ProposalChange } from "../domain/proposal-changes.js";
import { ProposalNotFound } from "../domain/proposal-not-found.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import type { Thread } from "../domain/thread.js";
import { draftProposal } from "../domain/thread-changes.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * The Proposals use cases (spec §2.2): a person drafts one in the Thread they talk in, and the user
 * applies or declines it there. Nothing changes until the user applies it; the module that owns
 * what it changes carries it out then.
 */
@Injectable()
export class ProposalService {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly appliers: ProposalAppliers,
    private readonly events: EventBus,
  ) {}

  /**
   * Drafts a Proposal in the Thread whose engine session is `sessionId`, as its card there; the
   * person goes on without waiting for the user. Refused for a session no Thread has now, and with
   * every reason the change would be refused if applied now.
   */
  async draft(sessionId: string, change: ProposedChange): Promise<Proposal> {
    const thread = await this.repository.findBySession(sessionId);
    if (!thread) throw new ProposalRefused(["The Office doesn't know this session's Thread."]);
    const problems = await this.appliers.problemsWith(change);
    if (problems.length > 0) throw new ProposalRefused(problems);
    const id = randomUUID();
    const { event } = await this.repository.update(thread.id, (latest) =>
      draftProposal(latest, { id, draftedAt: new Date(), change }),
    );
    if (event) await this.events.publish(event);
    return this.read(id);
  }

  /** As `draft`, a new value for the Office setting, from the value its owner keeps now. */
  async draftSetting(sessionId: string, setting: OfficeSetting, value: number): Promise<Proposal> {
    const from = await this.appliers.settingNow(setting);
    return this.draft(sessionId, { kind: setting, from, to: value });
  }

  async read(id: string): Promise<Proposal> {
    const proposal = await this.repository.proposal(id);
    if (!proposal) throw new ProposalNotFound(id);
    return proposal;
  }

  /** The Thread's Proposals, which its log's cards show. */
  listInThread(threadId: string): Promise<readonly Proposal[]> {
    return this.repository.proposalsIn(threadId);
  }

  /** Every open Proposal, the newest first, for a page that offers what waits on the user. */
  listOpen(): Promise<readonly Proposal[]> {
    return this.repository.openProposals();
  }

  /**
   * The user applies the Proposal: a new Role as they edited it before hiring, when they did, or
   * the change as drafted. Its owner's refusal leaves it open and is the answer; so is a
   * Proposal applied or declined already.
   */
  async apply(id: string, edited?: EditedHire): Promise<Proposal> {
    const thread = await this.threadOf(id);
    return this.change(id, async (stored) => {
      const applied = await this.appliers.apply(changeToApply(stored, edited), stored.draftedBy);
      return applyProposal(stored, thread, applied, new Date());
    });
  }

  /** The user declines the Proposal ("Not now"): nothing changes. */
  async decline(id: string): Promise<Proposal> {
    const thread = await this.threadOf(id);
    return this.change(id, (stored) =>
      Promise.resolve(declineProposal(stored, thread, new Date())),
    );
  }

  private async change<Event extends DomainEvent>(
    id: string,
    change: (proposal: Proposal) => Promise<ProposalChange<Event>>,
  ): Promise<Proposal> {
    const { proposal, event } = await this.repository.updateProposal(id, change);
    await this.events.publish(event);
    return proposal;
  }

  private async threadOf(proposalId: string): Promise<Thread> {
    const { threadId } = await this.read(proposalId);
    const thread = await this.repository.find(threadId);
    if (!thread) throw new Error(`Proposal ${proposalId}'s Thread is gone.`);
    return thread;
  }
}
