import type { Decision } from "./decision.js";
import { worksIn } from "./people-working.js";
import type { Home, Thread } from "./thread.js";

/** A person filling a Role now, as the Live view lists them. */
export interface HiredPerson {
  readonly roleKey: string;
  readonly name: string;
  readonly title: string;
  readonly hiredAt: Date;
}

/** A person's headline state, for drawing. */
export type LiveViewState = "working" | "consulting" | "waiting-on-you" | "idle";

/** One of the person's Agents: a session answering now in a Thread. */
export interface LiveAgent {
  readonly threadId: string;
  readonly home: Home;
  readonly kind: "stage" | "thread" | "consultation";
  /** The Decision a Consultation answers and who asked it, undefined when The Office did. */
  readonly consultation:
    { readonly decisionId: string; readonly askerRoleKey: string | undefined } | undefined;
}

/** A Decision of the person's put to a Consultant, who answers it now. */
export interface LiveConsulting {
  readonly decisionId: string;
  readonly threadId: string;
  readonly home: Home;
  readonly consultantRoleKey: string;
  readonly question: string;
  readonly since: Date;
}

/** A Decision in the person's Thread waiting on the user. */
export interface LiveWaitingOnYou {
  readonly decisionId: string;
  readonly threadId: string;
  readonly home: Home;
  /** The Office asked it, as when a Stage runs out of tries, a budget or the Definition of Done. */
  readonly byTheOffice: boolean;
  readonly question: string;
  readonly since: Date;
}

/** What one person is doing now, every activity listed. */
export interface LivePerson {
  readonly roleKey: string;
  readonly name: string;
  readonly title: string;
  readonly state: LiveViewState;
  readonly agents: readonly LiveAgent[];
  readonly consulting: readonly LiveConsulting[];
  readonly waitingOnYou: readonly LiveWaitingOnYou[];
  /** Set only when the state is idle. */
  readonly idleSince: Date | undefined;
}

/** What each person of The Office is doing now, in hiring order. */
export interface LiveView {
  readonly people: readonly LivePerson[];
}

/** The records the Live view is made from. */
export interface LiveViewRecords {
  /** Everyone filling a Role now, in hiring order. */
  readonly people: readonly HiredPerson[];
  /** Every Thread answering or holding an open Decision, each with its open Decisions. */
  readonly threads: readonly Thread[];
  /** When each person's last engine call ended, by the key of their Role. */
  readonly lastCalls: ReadonlyMap<string, Date>;
}

/**
 * What each person is doing now (spec §2.2): an Agent for each Thread they work in, consulting for
 * each of their Decisions put to a Consultant, waiting on you for each waiting on the user, and
 * idle with none of these. Threads of anyone not filling a Role now are left out.
 */
export function liveViewOf({ people, threads, lastCalls }: LiveViewRecords): LiveView {
  const oldestFirst = threads.toSorted(
    (one, other) => one.startedAt.getTime() - other.startedAt.getTime(),
  );
  return {
    people: people.map((person) => {
      const own = oldestFirst.filter((thread) => thread.roleKey === person.roleKey);
      return livePerson(person, own, lastCalls.get(person.roleKey));
    }),
  };
}

function livePerson(
  person: HiredPerson,
  threads: readonly Thread[],
  lastCallAt: Date | undefined,
): LivePerson {
  const agents = threads.filter(worksIn).map(liveAgent);
  const decisions = threads
    .flatMap((thread) => thread.openDecisions.map((decision) => ({ thread, decision })))
    .toSorted((one, other) => one.decision.askedAt.getTime() - other.decision.askedAt.getTime());
  const consulting = decisions.flatMap(({ thread, decision }) =>
    decision.putTo === undefined ? [] : [liveConsulting(thread, decision, decision.putTo)],
  );
  const waitingOnYou = decisions.flatMap(({ thread, decision }) =>
    decision.putTo === undefined ? [liveWaitingOnYou(thread, decision)] : [],
  );
  const state = headlineState(agents, consulting, waitingOnYou);
  return {
    roleKey: person.roleKey,
    name: person.name,
    title: person.title,
    state,
    agents,
    consulting,
    waitingOnYou,
    idleSince: state === "idle" ? later(person.hiredAt, lastCallAt) : undefined,
  };
}

function liveAgent({ id, home, stageThread, consultation }: Thread): LiveAgent {
  return {
    threadId: id,
    home,
    kind: stageThread ? "stage" : consultation ? "consultation" : "thread",
    consultation: consultation && {
      decisionId: consultation.decisionId,
      askerRoleKey: consultation.askerRoleKey,
    },
  };
}

function liveConsulting(
  thread: Thread,
  decision: Decision,
  consultantRoleKey: string,
): LiveConsulting {
  return {
    decisionId: decision.id,
    threadId: thread.id,
    home: thread.home,
    consultantRoleKey,
    question: decision.question,
    since: decision.askedAt,
  };
}

function liveWaitingOnYou(thread: Thread, decision: Decision): LiveWaitingOnYou {
  return {
    decisionId: decision.id,
    threadId: thread.id,
    home: thread.home,
    byTheOffice: decision.roleKey === undefined,
    question: decision.question,
    since: decision.askedAt,
  };
}

/** Waiting on you leads, then consulting, then working (spec §2.2 Defaults). */
function headlineState(
  agents: readonly LiveAgent[],
  consulting: readonly LiveConsulting[],
  waitingOnYou: readonly LiveWaitingOnYou[],
): LiveViewState {
  if (waitingOnYou.length > 0) return "waiting-on-you";
  if (consulting.length > 0) return "consulting";
  if (agents.length > 0) return "working";
  return "idle";
}

function later(hiredAt: Date, lastCallAt: Date | undefined): Date {
  return lastCallAt && lastCallAt > hiredAt ? lastCallAt : hiredAt;
}
