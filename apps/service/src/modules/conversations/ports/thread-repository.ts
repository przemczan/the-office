import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Decision } from "../domain/decision.js";
import type { Message } from "../domain/message.js";
import type { Proposal } from "../domain/proposal.js";
import type { ProposalChange } from "../domain/proposal-changes.js";
import type { Home, Thread } from "../domain/thread.js";
import type { ThreadChange } from "../domain/thread-changes.js";

/** The Thread after a change, with its event, or undefined when nothing changed. */
export interface ThreadUpdate<Event extends DomainEvent> {
  readonly thread: Thread;
  readonly event: Event | undefined;
}

/** Which logged messages `loggedIn` reads: those logged from `from` to `to`, both included. */
export interface LoggedMessagesRange {
  readonly from: Date;
  readonly to: Date;
  /** Only Threads with this person, by the key of their Role. */
  readonly roleKey?: string;
  /** Only Threads in these homes; undefined for any home, none for no Thread at all. */
  readonly homes?: readonly Home[];
  /** Only this Thread, by its id. */
  readonly threadId?: string;
}

/** Where a person's Threads are listed: in their chat, or on any Task. */
export type PersonsThreads = Extract<Home["kind"], "chat" | "task">;

/** Where a list read newest first goes on: after the row started at `at` with this id. */
export interface NewestFirstAfter {
  readonly at: Date;
  readonly id: string;
}

/** Some of a person's Threads, and how many they have in all. */
export interface PersonsThreadsRead {
  readonly threads: readonly Thread[];
  readonly total: number;
}

/** A Thread on a Task's title, undefined before its first message. */
export interface TaskThreadTitle {
  readonly taskId: string;
  readonly title: string | undefined;
}

/** A message in The Office's log, with the Thread it was logged in. */
export interface LoggedMessage {
  readonly thread: Thread;
  readonly message: Message;
}

/**
 * Where Threads are kept, each with The Office's log of its messages and the Decisions opened and
 * Proposals drafted in it, which a change saves with the Thread.
 */
export abstract class ThreadRepository {
  abstract add(thread: Thread): Promise<void>;

  abstract find(id: string): Promise<Thread | undefined>;

  /** The Thread whose engine session now is `sessionId`, if any. */
  abstract findBySession(sessionId: string): Promise<Thread | undefined>;

  /** Every Thread whose person is answering now, in any home. */
  abstract answering(): Promise<readonly Thread[]>;

  /** Every Thread whose person is answering now or that holds an open Decision, in any home. */
  abstract busy(): Promise<readonly Thread[]>;

  /** When each person's last engine call ended, over all their Threads, by the key of their Role. */
  abstract lastCallsByPerson(): Promise<ReadonlyMap<string, Date>>;

  /** The home's Threads, the newest started first. */
  abstract listIn(home: Home): Promise<readonly Thread[]>;

  /**
   * The person's Threads in their chat or on any Task, by their Role's key, the newest started
   * first, `limit` at most, those started after `after` (by time, then id) only when given, read by
   * the index on the person's Threads whatever their number; with how many they have in all.
   */
  abstract personsThreads(
    roleKey: string,
    where: PersonsThreads,
    after: NewestFirstAfter | undefined,
    limit: number,
  ): Promise<PersonsThreadsRead>;

  /** The title of each of the person's Threads on a Task, by its Task, the newest started first. */
  abstract titlesOnTasksWith(roleKey: string): Promise<readonly TaskThreadTitle[]>;

  /**
   * Applies `change` to the Thread as stored, holding it against other changes until the Thread and
   * the messages it logged are saved, so two changes at once never lose one. Saves nothing when
   * `change` returns undefined; throws ThreadNotFound when there is no such Thread.
   */
  abstract update<Event extends DomainEvent>(
    id: string,
    change: (thread: Thread) => ThreadChange<Event> | undefined,
  ): Promise<ThreadUpdate<Event>>;

  /** The Thread's log, in the order its messages were logged. */
  abstract messages(threadId: string): Promise<readonly Message[]>;

  /** The messages logged in the range, in any Thread it takes, the first logged first. */
  abstract loggedIn(range: LoggedMessagesRange): Promise<readonly LoggedMessage[]>;

  /** How many messages `loggedIn` would read for the range, without reading them. */
  abstract countLoggedIn(range: LoggedMessagesRange): Promise<number>;

  abstract decision(id: string): Promise<Decision | undefined>;

  /**
   * Runs `work` on the Decision as stored, holding it against every other `holdingDecision` of it
   * until `work` ends, so two answers at once never carry out the same answer twice: the second
   * reads the Decision as the first left it. `work` may change the Decision and its Thread through
   * `update` meanwhile; undefined when there is no such Decision.
   */
  abstract holdingDecision<Result>(
    id: string,
    work: (decision: Decision | undefined) => Promise<Result>,
  ): Promise<Result>;

  /** Those of the Decisions with the ids still there, in one read, in no set order. */
  abstract decisionsWithIds(ids: readonly string[]): Promise<readonly Decision[]>;

  /** The Thread's Decisions, open and answered, the first asked first. */
  abstract decisionsIn(threadId: string): Promise<readonly Decision[]>;

  /**
   * The Decisions an Agent asked on the Task that the user answered, in any of its Threads, the
   * first answered first. The Office's own, about limits, guide the next round through the walk.
   */
  abstract answeredOn(taskId: string): Promise<readonly Decision[]>;

  /**
   * Uses up the approval an answered Decision gave a held call, so it lets one call through. False
   * when it was used already or is no such Decision.
   */
  abstract spendApproval(decisionId: string): Promise<boolean>;

  /**
   * Every Decision on a Task waiting on the user under Needs you, the first asked first: never one
   * in a chat, which waits inline there (spec §2.7).
   */
  abstract openDecisions(): Promise<readonly Decision[]>;

  /**
   * Every Decision on no Task in an Initiative's Threads waiting on the user, the first asked first,
   * each with the Initiative its Thread is on.
   */
  abstract openInInitiativeThreads(): Promise<
    readonly (Decision & { readonly initiativeId: string })[]
  >;

  /** Every Decision on the Task still open, a Consultant's too, the first asked first. */
  abstract unansweredOn(taskId: string): Promise<readonly Decision[]>;

  /**
   * Every Decision on no Task still open, the first asked first: calls, a chat's Decisions waiting
   * on the user, and each Decision on an Initiative as a whole, waiting on the user or put to a
   * Consultant.
   */
  abstract unansweredOnNoTask(): Promise<readonly Decision[]>;

  abstract proposal(id: string): Promise<Proposal | undefined>;

  /** The Thread's Proposals, open, applied and declined, the first drafted first. */
  abstract proposalsIn(threadId: string): Promise<readonly Proposal[]>;

  /** Every open Proposal, in any Thread, the newest first. */
  abstract openProposals(): Promise<readonly Proposal[]>;

  /**
   * Applies `change` to the Proposal as stored, holding it against other changes until the change
   * is carried out and saved, so the user's two clicks at once never apply it twice. Saves nothing
   * when `change` throws; throws ProposalNotFound when there is no such Proposal.
   */
  abstract updateProposal<Event extends DomainEvent>(
    id: string,
    change: (proposal: Proposal) => Promise<ProposalChange<Event>>,
  ): Promise<ProposalChange<Event>>;
}
