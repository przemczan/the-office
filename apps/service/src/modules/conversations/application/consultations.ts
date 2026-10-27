import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import {
  consultantNamed,
  consultationOpening,
  consultationTitle,
  consultDecision,
  passedOnTo,
  type Consult,
  type ConsultantPerson,
} from "../domain/consult.js";
import { TurnEnded } from "../domain/conversation-events.js";
import type { Decision, DecisionAnswer } from "../domain/decision.js";
import type { Thread } from "../domain/thread.js";
import {
  passDecisionOn,
  putDecisionToUser,
  startConsultationThread,
} from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { DecisionService } from "./decision-service.js";
import { ThreadRunner } from "./thread-runner.js";

/** A Consultation whose Consultant the Decision still waits on. */
interface ConsultationAtWork {
  readonly consultantKey: string;
  readonly askerThreadId: string;
  readonly decision: Decision;
}

/**
 * Consultations (spec §2.2, §2.4, §6): an Agent's consult goes to the Consultant it names as a
 * Decision put to them, and they answer it in a sub-thread on the Task, in a fresh session with
 * their memory and the Task's brief. The Agent still waits on the Decision as it would on the
 * user, so the user may answer it in the Consultant's place: that takes the Consultation over. A
 * consult of someone who isn't a hired Consultant goes to the user. A Consultant asked to approve
 * may pass it on, at most two steps up, then it is the user's.
 */
@Injectable()
export class Consultations implements OnModuleInit {
  private readonly logger = new Logger(Consultations.name);

  constructor(
    private readonly roleCards: RoleCards,
    private readonly repository: ThreadRepository,
    private readonly decisions: DecisionService,
    private readonly runner: ThreadRunner,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    // The Consultation opens once the Agent's turn has ended, so the Consultant's answer finds the
    // Agent ready to take it.
    this.events.subscribe(TurnEnded, ({ thread }) => this.openFor(thread));
  }

  /**
   * Puts the consult to the Consultant it names, or to the user when it names no hired Consultant
   * or the asker is that person. Returns the Consultant, undefined when the user is asked.
   */
  async put(sessionId: string, consult: Consult): Promise<ConsultantPerson | undefined> {
    const asker = await this.repository.findBySession(sessionId);
    if (!asker) throw new ThreadRefused(["The Office doesn't know this session's Thread."]);
    const consultant = consultantNamed(
      consult.person,
      await this.roleCards.consultants(),
      asker.session?.roleKey ?? asker.roleKey,
    );
    const draft = consultDecision(
      consult,
      consultant ? { kind: "consultant", roleKey: consultant.roleKey } : { kind: "user" },
    );
    await this.decisions.open(sessionId, draft, consultant?.roleKey);
    return consultant;
  }

  /**
   * The Consultant's answer, given from the Consultation's session: it answers the Decision the
   * Agent waits on. Refused outside a Consultation, and once the Decision is answered, as when the
   * user took the Consultation over.
   */
  async answer(sessionId: string, answer: DecisionAnswer): Promise<void> {
    const { consultantKey, decision } = await this.waitingIn(sessionId);
    await this.decisions.answer(decision.id, answer, {
      roleKey: consultantKey,
      name: await this.nameOf(consultantKey),
    });
  }

  /**
   * The Consultant passes the approval put to them on (spec §2.2), from the Consultation's session:
   * to the Consultant they name, who answers it in a Consultation of their own, or to the user
   * once it is the last step up or they name nobody who can be consulted. Returns the next
   * Consultant, undefined when the user is asked.
   */
  async passOn(
    sessionId: string,
    person: string | undefined,
    reason: string,
  ): Promise<ConsultantPerson | undefined> {
    const { consultantKey, askerThreadId, decision } = await this.waitingIn(sessionId);
    const next = passedOnTo(decision, person, await this.roleCards.consultants());
    const { thread: asker, event } = await this.repository.update(askerThreadId, (latest) =>
      passDecisionOn(latest, {
        decisionId: decision.id,
        by: consultantKey,
        to: next?.roleKey,
        reason,
        passedOnAt: new Date(),
      }),
    );
    if (event) await this.events.publish(event);
    if (next) await this.openFor(asker);
    return next;
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
    if (decision.putTo !== consultation.roleKey) {
      throw new ThreadRefused([
        "You passed this Decision on: it waits on someone else now. There is nothing left to answer.",
      ]);
    }
    return { consultantKey: consultation.roleKey, askerThreadId, decision };
  }

  /**
   * Opens the Consultation for the Decision the Thread's Agent put to a Consultant, once for each
   * Consultant it is put to.
   */
  private async openFor(asker: Thread): Promise<void> {
    const decision = asker.openDecision;
    if (!decision?.putTo || asker.consultation) return;
    const consultantKey = decision.putTo;
    const threads = await this.repository.listIn(asker.home);
    const opened = threads.some(
      ({ consultation, roleKey }) =>
        consultation?.decisionId === decision.id && roleKey === consultantKey,
    );
    if (opened) return;
    try {
      await this.start(asker, decision, consultantKey);
    } catch (error) {
      this.logger.warn(
        `Consultation for Decision ${decision.id} did not start; the user is asked: ${String(error)}`,
      );
      await this.putToUser(asker.id, decision.id);
    }
  }

  private async start(asker: Thread, decision: Decision, consultantKey: string): Promise<void> {
    if (asker.home.kind !== "task") return;
    const askerKey = decision.roleKey ?? asker.roleKey;
    const [askerName, consultant, passers] = await Promise.all([
      this.nameOf(askerKey),
      this.roleCards.find(consultantKey),
      Promise.all(
        decision.passedOn.map(async ({ roleKey, reason }) => ({
          name: await this.nameOf(roleKey),
          reason,
        })),
      ),
    ]);
    if (!consultant) throw new Error(`Nobody fills the Role "${consultantKey}" now.`);
    const { thread, event } = startConsultationThread(
      randomUUID(),
      {
        taskId: asker.home.taskId,
        roleKey: consultantKey,
        title: consultationTitle(askerName, consultant.card.name),
      },
      { decisionId: decision.id, askerThreadId: asker.id, askerRoleKey: askerKey },
      new Date(),
    );
    await this.repository.add(thread);
    await this.events.publish(event);
    await this.runner.open(thread.id, consultationOpening(decision, askerName, passers));
  }

  /** The name of the person who fills the Role; its key when nobody does now. */
  private async nameOf(roleKey: string): Promise<string> {
    return (await this.roleCards.find(roleKey))?.card.name ?? roleKey;
  }

  /** The Decision waits on the user instead, which tells them it needs them. */
  private async putToUser(askerThreadId: string, decisionId: string): Promise<void> {
    const { event } = await this.repository.update(askerThreadId, (latest) =>
      putDecisionToUser(latest, decisionId, new Date()),
    );
    if (event) await this.events.publish(event);
  }
}
