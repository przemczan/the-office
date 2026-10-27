import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import {
  consultantNamed,
  consultationOpening,
  consultationTitle,
  consultDecision,
  type Consult,
  type ConsultantPerson,
} from "../domain/consult.js";
import { TurnEnded } from "../domain/conversation-events.js";
import type { DecisionAnswer } from "../domain/decision.js";
import type { Thread } from "../domain/thread.js";
import { putDecisionToUser, startConsultationThread } from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { DecisionService } from "./decision-service.js";
import { ThreadRunner } from "./thread-runner.js";

/**
 * Consultations (spec §2.4, §6): an Agent's consult goes to the Consultant it names as a Decision
 * put to them, and they answer it in a sub-thread on the Task, in a fresh session with their
 * memory and the Task's brief. The Agent still waits on the Decision as it would on the user, so
 * the user may answer it in the Consultant's place: that takes the Consultation over. A consult
 * of someone who isn't a hired Consultant goes to the user.
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
    const consultation = await this.repository.findBySession(sessionId);
    if (!consultation?.consultation) {
      throw new ThreadRefused(["You answer a consult only in the Consultation you were asked in."]);
    }
    const decision = await this.repository.decision(consultation.consultation.decisionId);
    if (!decision || decision.answer) {
      throw new ThreadRefused([
        "This Decision is answered already: the user took the Consultation over. There is nothing left to answer.",
      ]);
    }
    const consultant = await this.roleCards.find(consultation.roleKey);
    await this.decisions.answer(decision.id, answer, {
      roleKey: consultation.roleKey,
      name: consultant?.card.name ?? consultation.roleKey,
    });
  }

  /** Opens the Consultation for the Decision the Thread's Agent put to a Consultant, once. */
  private async openFor(asker: Thread): Promise<void> {
    const decision = asker.openDecision;
    if (!decision?.putTo || asker.consultation) return;
    const threads = await this.repository.listIn(asker.home);
    if (threads.some(({ consultation }) => consultation?.decisionId === decision.id)) return;
    try {
      await this.start(asker, decision.id, decision.putTo);
    } catch (error) {
      this.logger.warn(
        `Consultation for Decision ${decision.id} did not start; the user is asked: ${String(error)}`,
      );
      await this.putToUser(asker.id, decision.id);
    }
  }

  private async start(asker: Thread, decisionId: string, consultantKey: string): Promise<void> {
    if (asker.home.kind !== "task" || !asker.openDecision) return;
    const askerKey = asker.openDecision.roleKey ?? asker.roleKey;
    const [askerRole, consultant] = await Promise.all([
      this.roleCards.find(askerKey),
      this.roleCards.find(consultantKey),
    ]);
    if (!consultant) throw new Error(`Nobody fills the Role "${consultantKey}" now.`);
    const askerName = askerRole?.card.name ?? askerKey;
    const { thread, event } = startConsultationThread(
      randomUUID(),
      {
        taskId: asker.home.taskId,
        roleKey: consultantKey,
        title: consultationTitle(askerName, consultant.card.name),
      },
      { decisionId, askerThreadId: asker.id, askerRoleKey: askerKey },
      new Date(),
    );
    await this.repository.add(thread);
    await this.events.publish(event);
    await this.runner.open(thread.id, consultationOpening(asker.openDecision, askerName));
  }

  /** The Decision waits on the user instead, which tells them it needs them. */
  private async putToUser(askerThreadId: string, decisionId: string): Promise<void> {
    const { event } = await this.repository.update(askerThreadId, (latest) =>
      putDecisionToUser(latest, decisionId, new Date()),
    );
    if (event) await this.events.publish(event);
  }
}
