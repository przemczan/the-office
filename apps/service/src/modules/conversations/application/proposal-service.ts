import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { isClosedConsultationOnTask } from "../domain/conversation-tabs.js";
import {
  changeToApply,
  proposalTargets,
  type EditedHire,
  type Proposal,
  type ProposalDeclinedBecause,
  type ProposedChange,
} from "../domain/proposal.js";
import {
  applyProposal,
  declineProposal,
  declineProposalOnItsOwn,
  type ProposalChange,
} from "../domain/proposal-changes.js";
import { ProposalOutOfDate } from "../domain/proposal-out-of-date.js";
import { ProposalNotFound } from "../domain/proposal-not-found.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import type { Home, Thread } from "../domain/thread.js";
import type { UserRef } from "../domain/user.js";
import { draftProposal } from "../domain/thread-changes.js";
import { ThreadRepository, type ProposalInHome } from "../ports/thread-repository.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/** An open Proposal, where it waits on the user. */
export interface ProposalWaitingOnTheUser {
  readonly id: string;
  readonly threadId: string;
  /** Who drafted it, by the key of their Role. */
  readonly draftedBy: string;
  readonly draftedAt: Date;
  /** The home of the Thread it was drafted in. */
  readonly home: Home;
  /** The skill whose update it drafts, by name, for a skill update; undefined for any other. */
  readonly skillUpdate: string | undefined;
}

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

  /** The Proposal as its card shows it, its change read as this release reads it (`ProposalAppliers.shown`). */
  shown(proposal: Proposal): Proposal {
    return { ...proposal, change: this.appliers.shown(proposal.change) };
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
   * Every open Proposal with its Thread's home, the oldest first, for what waits on the user: never
   * one in a closed Consultation on a Task, whose card can't be opened (spec §2.4.2).
   */
  async waitingOnTheUser(): Promise<readonly ProposalWaitingOnTheUser[]> {
    const open = await this.repository.openProposalsInHomes();
    const unreachable = await this.inClosedConsultations(open);
    return open
      .filter(({ proposal }) => !unreachable.has(proposal.id))
      .map(({ proposal: { id, threadId, draftedBy, draftedAt, change }, thread: { home } }) => ({
        id,
        threadId,
        draftedBy,
        draftedAt,
        home,
        skillUpdate: change.kind === "skill-update" ? change.name : undefined,
      }));
  }

  /**
   * Declines every open Proposal in a Consultation on a Task that has closed (spec §2.4.3): nobody
   * can open its card to answer it any more.
   */
  async declineInClosedConsultations(): Promise<void> {
    const unreachable = await this.inClosedConsultations(
      await this.repository.openProposalsInHomes(),
    );
    for (const id of unreachable) await this.declineOnItsOwn(id, { kind: "consultation-closed" });
  }

  /** The ids of the open Proposals of `open` drafted in a Consultation on a Task that has closed. */
  private async inClosedConsultations(
    open: readonly ProposalInHome[],
  ): Promise<ReadonlySet<string>> {
    const inConsultationsOnTasks = open.filter(
      ({ thread }) => thread.home.kind === "task" && thread.consultation,
    );
    if (inConsultationsOnTasks.length === 0) return new Set();
    const decisions = await this.repository.decisionsWithIds([
      ...new Set(
        inConsultationsOnTasks.flatMap(({ thread }) => thread.consultation?.decisionId ?? []),
      ),
    ]);
    return new Set(
      inConsultationsOnTasks
        .filter(({ thread }) =>
          isClosedConsultationOnTask(
            thread,
            decisions.find(({ id }) => id === thread.consultation?.decisionId),
          ),
        )
        .map(({ proposal }) => proposal.id),
    );
  }

  /**
   * The user `by` applies the Proposal: a new Role as they edited it before hiring, when they did,
   * or the change as drafted; the Proposal records who applied it. Its owner's refusal leaves it
   * open and is the answer; so is a Proposal applied or declined already.
   */
  async apply(id: string, by: UserRef, edited?: EditedHire): Promise<Proposal> {
    const thread = await this.threadOf(id);
    let applied: Proposal;
    try {
      applied = await this.change(id, async (stored) => {
        const change = await this.appliers.apply(
          changeToApply(stored, edited),
          stored.draftedBy,
          by,
          stored.id,
        );
        return applyProposal(
          stored,
          thread,
          await this.appliers.withoutSecrets(change),
          new Date(),
          by,
        );
      });
    } catch (error) {
      // Kept apart from the refused apply, which saves nothing: the card then reads Out of date.
      if (error instanceof ProposalOutOfDate) await this.repository.markProposalOutOfDate(id);
      throw error;
    }
    await this.declineSupersededBy(applied);
    return applied;
  }

  /** The user `by` declines the Proposal ("Not now"): nothing changes but who declined it. */
  async decline(id: string, by: UserRef): Promise<Proposal> {
    const thread = await this.threadOf(id);
    return this.change(id, async (stored) => {
      const declined = declineProposal(stored, thread, new Date(), by);
      return {
        ...declined,
        proposal: {
          ...declined.proposal,
          change: await this.appliers.withoutSecrets(declined.proposal.change),
        },
      };
    });
  }

  /**
   * Declines every open Proposal drafted before `applied` that changes some of the same (spec
   * §2.2): the user's choice is made, and what those started from has changed.
   */
  private async declineSupersededBy(applied: Proposal): Promise<void> {
    const targets = new Set(proposalTargets(applied.change));
    if (targets.size === 0) return;
    const superseded = (await this.repository.openProposals()).filter(
      ({ change, draftedAt }) =>
        draftedAt < applied.draftedAt &&
        proposalTargets(change).some((target) => targets.has(target)),
    );
    for (const { id } of superseded) {
      await this.declineOnItsOwn(id, { kind: "superseded", proposalId: applied.id });
    }
  }

  /** The Office declines the Proposal on its own; one answered meanwhile is left as it is. */
  private async declineOnItsOwn(id: string, because: ProposalDeclinedBecause): Promise<void> {
    const thread = await this.threadOf(id);
    try {
      await this.change(id, async (stored) => {
        const declined = declineProposalOnItsOwn(stored, thread, new Date(), because);
        return {
          ...declined,
          proposal: {
            ...declined.proposal,
            change: await this.appliers.withoutSecrets(declined.proposal.change),
          },
        };
      });
    } catch (error) {
      if (!(error instanceof ProposalRefused)) throw error;
    }
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
