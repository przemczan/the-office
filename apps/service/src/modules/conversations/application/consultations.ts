import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import {
  backToTheCallerWords,
  callProblems,
  consultantAnswerProblems,
  consultantNamed,
  consultationAnswerLine,
  consultationAskedLine,
  consultationOpening,
  consultationTitle,
  consultDecision,
  consultantCouldNotAnswerWords,
  couldNotAnswerLine,
  couldNotAnswerWords,
  passedOnTo,
  passedOnToTheUserWords,
  requestToOneselfRefusal,
  THE_OFFICE,
  type Consult,
  type ConsultantPerson,
} from "../domain/consult.js";
import { MessagesLogged, TurnEnded } from "../domain/conversation-events.js";
import {
  closedDecisionRefusal,
  formAnswerWords,
  isOpen,
  type Decision,
  type DecisionAnswer,
} from "../domain/decision.js";
import { isPersonsChat, type Thread } from "../domain/thread.js";
import {
  logMessages,
  passDecisionOn,
  putDecisionToUser,
  startConsultationThread,
  type ConsultationThreadStart,
} from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { CallChains } from "./call-chains.js";
import { DecisionService } from "./decision-service.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { ThreadRunner } from "./thread-runner.js";

/** Why a Consultation stopped as the fire alarm sounded, in its log. */
export const STOPPED_BY_THE_FIRE_ALARM =
  "The fire alarm stopped this Consultation: it goes on after the all clear.";

/** A Consultation whose Consultant the Decision still waits on. */
interface ConsultationAtWork {
  readonly consultation: Thread;
  readonly askerThreadId: string;
  readonly decision: Decision;
}

/**
 * Consultations (spec §2.2, §2.4, §6): an Agent's consult or call goes to the Consultant it names
 * as a Decision put to them, and they answer it in a sub-thread, on the Task or, for a call made
 * outside a Task, in their own chat, in a fresh session of their own: their tools and permissions,
 * never the asker's. The Agent still waits on the Decision as it would on the user; on a Task the
 * user may answer it in the Consultant's place, which takes the Consultation over. A consult of
 * someone who isn't a hired Consultant goes to the user: under Needs you on a Task, inline in a
 * person's chat, and back to the caller from anywhere else on no Task. A Consultant may call someone themselves and pass an approval on, at most
 * `CALL_STEPS` people down one chain and nobody twice. The fire alarm stops each Consultation
 * answering and opens none while it is on; the Decision still waits on its Consultant, who is asked
 * again once the all clear is given (spec §2.8).
 */
@Injectable()
export class Consultations implements OnModuleInit {
  private readonly logger = new Logger(Consultations.name);

  constructor(
    private readonly roleCards: RoleCards,
    private readonly repository: ThreadRepository,
    private readonly decisions: DecisionService,
    private readonly runner: ThreadRunner,
    private readonly fireAlarm: FireAlarmInThreads,
    private readonly chains: CallChains,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    // The Consultation opens once the Agent's turn has ended, so the Consultant's answer finds the
    // Agent ready to take it.
    this.events.subscribe(TurnEnded, ({ thread }) => this.openFor(thread));
    this.events.subscribe(MessagesLogged, (logged) => this.afterFailure(logged));
    this.fireAlarm.whenSounded(() => this.stopForFireAlarm());
    this.fireAlarm.whenAllClear((taskIds) => this.goOnAfterAllClear(taskIds));
  }

  /**
   * Puts the consult to the Consultant it names, or to the user when it names no hired Consultant
   * or the asker is that person: on a Task under Needs you, and from a person's chat inline there
   * (spec §2.7). Refused as a request to the asker's own Role, which they do themselves; for someone
   * already in the chain of calls, once it has asked `CALL_STEPS` people; and from a Consultation in a chat or an Initiative's Thread on no Task naming nobody
   * who can be called, which has nowhere to ask the user: the caller asks the user in their answer.
   * Returns the Consultant, undefined when the user is asked.
   */
  async put(
    sessionId: string,
    consult: Consult,
    taskId?: string,
  ): Promise<ConsultantPerson | undefined> {
    const asker = await this.repository.findBySession(sessionId);
    if (!asker) throw new ThreadRefused(["The Office doesn't know this session's Thread."]);
    const askerRoleKey = asker.session?.roleKey ?? asker.roleKey;
    const ownRefusal = await this.requestToOneself(consult, askerRoleKey);
    if (ownRefusal !== undefined) throw new ThreadRefused([ownRefusal]);
    const consultant = consultantNamed(
      consult.person,
      await this.roleCards.consultants(),
      askerRoleKey,
    );
    if (consultant) {
      const problems = callProblems(await this.chains.ofCaller(asker), consultant);
      if (problems.length > 0) throw new ThreadRefused(problems);
    } else if (callsOnNoTask(asker, taskId) && !isPersonsChat(asker) && consult.person?.trim()) {
      // Naming nobody, it asks the user directly, which a call on no Task outside a person's chat
      // refuses: it has nowhere to wait on the user.
      throw new ThreadRefused([
        "Nobody who can be called fills that Role: ask the user in your answer instead.",
      ]);
    }
    const draft = consultDecision(
      consult,
      consultant ? { kind: "consultant", roleKey: consultant.roleKey } : { kind: "user" },
    );
    await this.decisions.open(sessionId, draft, { putTo: consultant?.roleKey, taskId });
    return consultant;
  }

  /** Why a request the asker puts to their own Role is refused; undefined for any other consult. */
  private async requestToOneself(
    consult: Consult,
    askerRoleKey: string,
  ): Promise<string | undefined> {
    if (consult.kind !== "request") return undefined;
    const own = await this.roleCards.find(askerRoleKey);
    if (!own) return undefined;
    const { name, title } = own.card;
    return requestToOneselfRefusal(consult, { roleKey: askerRoleKey, name, title });
  }

  /**
   * The Consultant's answer, given from the Consultation's session: it answers the Decision the
   * Agent waits on, and the Consultation logs it as a line. Refused outside a Consultation, and
   * once the Decision is answered, as when the user took the Consultation over.
   */
  async answer(sessionId: string, answer: DecisionAnswer): Promise<void> {
    const { consultation, decision } = await this.waitingIn(sessionId);
    const problems = consultantAnswerProblems(decision, answer);
    if (problems.length > 0) throw new ThreadRefused(problems);
    await this.decisions.answer(decision.id, answer, {
      kind: "consultant",
      roleKey: consultation.roleKey,
      name: await this.nameOf(consultation.roleKey),
    });
    const askerName = await this.askerNameOf(decision);
    await this.logLine(
      consultation.id,
      decision.id,
      consultationAnswerLine(askerName, formAnswerWords(decision, answer)),
    );
  }

  /**
   * The Consultant passes the approval put to them on (spec §2.2), from the Consultation's session:
   * to the Consultant they name, who answers it in a Consultation of their own, or to the user
   * once the chain of calls has asked `CALL_STEPS` people or they name nobody who can be consulted.
   * Refused for someone already in the chain. The Office's Decision put to them goes on to the
   * user (spec §2.3), inline in the caller's chat for a call from a person's chat; from a
   * Consultation in a chat or an Initiative's Thread on no Task, it goes back to the caller as an
   * answer (`fallsBackToTheCaller`). Returns the next Consultant, undefined when the user is asked.
   */
  async passOn(
    sessionId: string,
    person: string | undefined,
    reason: string,
  ): Promise<ConsultantPerson | undefined> {
    const { consultation, askerThreadId, decision } = await this.waitingIn(sessionId);
    const next = passedOnTo(
      decision,
      person,
      await this.roleCards.consultants(),
      await this.chains.ofDecision(decision),
    );
    if (next.kind === "refused") throw new ThreadRefused([...next.problems]);
    const to = next.kind === "consultant" ? next.consultant : undefined;
    const { thread: asker, event } = await this.repository.update(askerThreadId, (latest) =>
      passDecisionOn(latest, {
        decisionId: decision.id,
        by: consultation.roleKey,
        to: to?.roleKey,
        reason,
        passedOnAt: new Date(),
      }),
    );
    if (event) await this.events.publish(event);
    if (to) {
      await this.openFor(asker);
    } else if (fallsBackToTheCaller(asker, decision)) {
      await this.backToTheCaller(
        decision.id,
        passedOnToTheUserWords(await this.nameOf(consultation.roleKey), reason),
      );
    }
    return to;
  }

  /** The fire alarm sounded: every Consultation answering stops now (spec §2.8). */
  async stopForFireAlarm(): Promise<void> {
    for (const thread of await this.repository.answering()) {
      if (!thread.consultation) continue;
      await this.runner
        .stopAnswering(thread.id, STOPPED_BY_THE_FIRE_ALARM)
        .catch((error: unknown) => {
          this.logger.error(
            `Consultation ${thread.id} didn't stop for the fire alarm: ${String(error)}`,
          );
        });
    }
  }

  /**
   * The all clear was given (spec §2.8): on each of the Tasks that go on, and for every call made
   * outside a Task, a Decision still waiting on its Consultant has them asked: again in the
   * Consultation the alarm stopped, or in one it kept from opening.
   */
  async goOnAfterAllClear(taskIds: readonly string[]): Promise<void> {
    const onTasks = await readEach(taskIds, (taskId) =>
      this.repository.listIn({ kind: "task", taskId }),
    );
    for (const asker of [...onTasks.flat(), ...(await this.callersOutsideTasks())]) {
      await this.askAgainFor(asker).catch((error: unknown) => {
        this.logger.error(
          `Thread ${asker.id}'s Consultant wasn't asked again after the all clear: ${String(error)}`,
        );
      });
    }
  }

  /**
   * The Threads waiting on a call made outside a Task, which the fire alarm holds no Task for: those
   * of a person someone fills, as nobody else could take the answer.
   */
  private async callersOutsideTasks(): Promise<readonly Thread[]> {
    const calls = (await this.repository.unansweredOnNoTask()).filter(
      ({ putTo }) => putTo !== undefined,
    );
    const callers: Thread[] = [];
    for (const { threadId } of calls) {
      const thread = await this.repository.find(threadId);
      if (thread && (await this.roleCards.find(thread.roleKey))) callers.push(thread);
    }
    return callers;
  }

  private async askAgainFor(asker: Thread): Promise<void> {
    const decision = putToAConsultant(asker);
    if (!decision?.putTo) return;
    const stopped = await this.consultationOf(asker, decision);
    if (!stopped) {
      await this.openFor(asker);
      return;
    }
    if (stopped.state === "answering") return;
    await this.runner.askAgain(stopped.id, await this.openingFor(decision));
  }

  /** The Consultation the session works and the Decision that waits on its Consultant. */
  private async waitingIn(sessionId: string): Promise<ConsultationAtWork> {
    const consultation = await this.repository.findBySession(sessionId);
    if (!consultation?.consultation) {
      throw new ThreadRefused(["You answer a consult only in the Consultation you were asked in."]);
    }
    const { decisionId, askerThreadId } = consultation.consultation;
    const decision = await this.repository.decision(decisionId);
    if (!decision || decision.answer) {
      throw new ThreadRefused([
        "This Decision is answered already: the user took the Consultation over, or someone it was passed on to answered. There is nothing left to answer.",
      ]);
    }
    if (decision.closedAt) throw new ThreadRefused([closedDecisionRefusal(decision)]);
    if (decision.putTo !== consultation.roleKey) {
      throw new ThreadRefused([
        "You passed this Decision on: it waits on someone else now. There is nothing left to answer.",
      ]);
    }
    return { consultation, askerThreadId, decision };
  }

  /**
   * Opens the Consultation for the Decision the Thread's Agent, or The Office, put to a Consultant,
   * once for each Consultant it is put to; none while the fire alarm is on. A Consultation that
   * can't start leaves the Decision to the user (`putToUser`).
   */
  async openFor(asker: Thread): Promise<void> {
    const decision = putToAConsultant(asker);
    if (!decision?.putTo) return;
    if ((await this.fireAlarm.read()).on) return;
    if (await this.consultationOf(asker, decision)) return;
    const consultantKey = decision.putTo;
    try {
      await this.start(asker, decision, consultantKey);
    } catch (error) {
      this.logger.warn(
        `Consultation for Decision ${decision.id} did not start; the user is asked: ${String(error)}`,
      );
      await this.putToUser(asker.id, decision, consultantKey, messageOf(error));
    }
  }

  /**
   * A Consultation whose session failed or never started leaves its Decision to the user, as one
   * that can't open does, so it never waits on a Consultant who isn't answering. The fire alarm's
   * stop is no failure: the Consultant is asked again at the all clear.
   */
  async afterFailure({ thread, messages }: MessagesLogged): Promise<void> {
    if (!thread.consultation) return;
    const failure = messages.find(
      (message) => message.kind === "failure" && message.reason !== STOPPED_BY_THE_FIRE_ALARM,
    );
    if (failure?.kind !== "failure") return;
    const { decisionId, askerThreadId } = thread.consultation;
    const decision = await this.repository.decision(decisionId);
    if (!decision || !isOpen(decision) || decision.putTo !== thread.roleKey) return;
    this.logger.warn(
      `Consultation ${thread.id} couldn't answer Decision ${decision.id}; the user is asked: ${failure.reason}`,
    );
    await this.putToUser(askerThreadId, decision, thread.roleKey, failure.reason);
  }

  /** The Consultation opened for the Decision with the Consultant it is put to now, if any. */
  private async consultationOf(asker: Thread, decision: Decision): Promise<Thread | undefined> {
    const home = consultationHome(asker, decision, decision.putTo ?? "");
    const threads = await this.repository.listIn(home);
    return threads.find(
      ({ consultation, roleKey }) =>
        consultation?.decisionId === decision.id && roleKey === decision.putTo,
    );
  }

  private async start(asker: Thread, decision: Decision, consultantKey: string): Promise<void> {
    const home = consultationHome(asker, decision, consultantKey);
    const [askerName, consultant, opening] = await Promise.all([
      this.askerNameOf(decision),
      this.roleCards.find(consultantKey),
      this.openingFor(decision),
    ]);
    if (!consultant) throw new Error(`Nobody fills the Role "${consultantKey}" now.`);
    const start: ConsultationThreadStart = {
      home,
      roleKey: consultantKey,
      title: consultationTitle(askerName, consultant.card.name),
    };
    const { thread, event } = startConsultationThread(
      randomUUID(),
      start,
      { decisionId: decision.id, askerThreadId: asker.id, askerRoleKey: decision.roleKey },
      new Date(),
    );
    await this.repository.add(thread);
    await this.events.publish(event);
    await this.logLine(thread.id, decision.id, consultationAskedLine(askerName, decision));
    await this.runner.open(thread.id, opening);
  }

  /** What the Consultant is asked: the Decision, who asks it, and who passed it on, with why. */
  private async openingFor(decision: Decision): Promise<string> {
    const [askerName, passers] = await Promise.all([
      this.askerNameOf(decision),
      Promise.all(
        decision.passedOn.map(async ({ roleKey, reason }) => ({
          name: await this.nameOf(roleKey),
          reason,
        })),
      ),
    ]);
    return consultationOpening(decision, askerName, passers);
  }

  /**
   * The Office's line about the Consultation of `decisionId`, in the Consultation or its asker's
   * Thread: what it was asked and its answer, as the asker's Thread shows its card, or what the
   * Consultant did there (`ConsultationsOnTasks.logOfficeLine`).
   */
  async logLine(threadId: string, decisionId: string, text: string): Promise<void> {
    const { event } = await this.repository.update(threadId, (latest) =>
      logMessages(
        latest,
        [
          {
            kind: "consultation-line",
            id: randomUUID(),
            threadId,
            at: new Date(),
            decisionId,
            text,
          },
        ],
        new Date(),
      ),
    );
    if (event) await this.events.publish(event);
  }

  private async askerNameOf(decision: Decision): Promise<string> {
    return decision.roleKey === undefined ? THE_OFFICE : this.nameOf(decision.roleKey);
  }

  /** The name of the person who fills the Role; its key when nobody does now. */
  private async nameOf(roleKey: string): Promise<string> {
    return (await this.roleCards.find(roleKey))?.card.name ?? roleKey;
  }

  /**
   * The Decision is the user's instead, with why: it waits on them, its card saying why and the
   * asker's Thread logging it, under Needs you on a Task and inline in a person's chat (spec
   * §2.7). From a Consultation in a chat or an Initiative's Thread on no Task, which have nowhere
   * to wait on the user, The Office answers the caller so they ask the user.
   */
  private async putToUser(
    askerThreadId: string,
    decision: Decision,
    consultantKey: string,
    reason: string,
  ): Promise<void> {
    const name = await this.nameOf(consultantKey);
    const asker = await this.repository.find(askerThreadId);
    if (!asker) return;
    if (fallsBackToTheCaller(asker, decision)) {
      await this.backToTheCaller(decision.id, consultantCouldNotAnswerWords(name, reason));
      return;
    }
    const { event } = await this.repository.update(askerThreadId, (latest) =>
      putDecisionToUser(
        latest,
        decision.id,
        { consultantKey, why: couldNotAnswerWords(reason) },
        new Date(),
      ),
    );
    if (!event) return;
    await this.events.publish(event);
    await this.logLine(askerThreadId, decision.id, couldNotAnswerLine(name, reason));
  }

  private async backToTheCaller(decisionId: string, why: string): Promise<void> {
    await this.decisions.answer(
      decisionId,
      { kind: "asked-again", generalComment: backToTheCallerWords(why) },
      { kind: "the-office" },
    );
  }
}

/** The Decision the Thread waits on that is put to a Consultant. */
function putToAConsultant({ openDecisions }: Thread): Decision | undefined {
  return openDecisions.find((decision) => decision.putTo !== undefined);
}

/**
 * Where the Consultation of a Decision asked in `asker` opens (spec §2.4): on the asker's Task, or
 * in the Consultant's own chat for a call made from a chat or a Consultation there. A call from an
 * Initiative's Thread opens on the Task it names, as a planning Thread's Decisions are, else in the
 * Consultant's own chat, as a chat's call does.
 */
function consultationHome(
  asker: Thread,
  decision: Decision,
  consultantKey: string,
): ConsultationThreadStart["home"] {
  const { home } = asker;
  switch (home.kind) {
    case "task":
      return home;
    case "chat":
      return { kind: "chat", roleKey: consultantKey };
    case "initiative":
      return decision.taskId === undefined
        ? { kind: "chat", roleKey: consultantKey }
        : { kind: "task", taskId: decision.taskId };
  }
}

/**
 * Whether the user's turn at a Decision asked in `asker` goes back to the caller as The Office's
 * answer: for a call on no Task from a Consultation in a chat or an Initiative's Thread, which have
 * nowhere to wait on the user. On a Task it waits under Needs you, in a person's chat inline there.
 */
function fallsBackToTheCaller(asker: Thread, decision: Decision): boolean {
  return decision.taskId === undefined && !isPersonsChat(asker);
}

/** Whether a call from `asker` naming `taskId` is on no Task: from a chat, or an Initiative's Thread naming none. */
function callsOnNoTask({ home }: Thread, taskId: string | undefined): boolean {
  return home.kind === "chat" || (home.kind === "initiative" && taskId === undefined);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
