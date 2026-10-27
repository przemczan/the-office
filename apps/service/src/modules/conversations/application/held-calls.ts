import { Injectable } from "@nestjs/common";
import {
  hardSwitchInEffect,
  HARD_SWITCH_LABELS,
  RoleCards,
  type HardSwitchKey,
} from "../../people/index.js";
import { APPROVAL_OPTIONS, approvalQuestion } from "../domain/consult.js";
import { heldCallRuling } from "../domain/held-call.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Consultations } from "./consultations.js";

/** What becomes of a call behind a Hard switch: it runs now, is refused, or waits on approval. */
export type HeldCallOutcome =
  | { readonly kind: "proceed" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "held"; readonly waitingOn: string };

/** The call as the Agent makes it, and why. */
export interface HeldCallRequest {
  readonly sessionId: string;
  readonly switchKey: HardSwitchKey;
  /** The call in the user's words. The same call must read the same, so its approval is found. */
  readonly call: string;
  readonly context: string;
  readonly why: string;
}

/**
 * Holds the calls behind the enforced Hard switches (spec §6). The switch on the calling person's
 * card decides: Allowed runs, Never refuses, Ask me and Consult open an approval for the call, of the Consultant a Consult names, or of the user.
 * Nothing waits in the tool call: the answer comes as the Agent's next message, and its repeat of
 * the call then runs once if the answer was "Allow once".
 */
@Injectable()
export class HeldCalls {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly threads: ThreadRepository,
    private readonly consultations: Consultations,
  ) {}

  async hold(request: HeldCallRequest): Promise<HeldCallOutcome> {
    const thread = await this.threads.findBySession(request.sessionId);
    if (!thread) return refused("The Office doesn't know this session's Thread.");
    const session = await this.roleCards.find(thread.roleKey);
    if (!session) return refused("Nobody fills your Role now.");
    const inEffect = hardSwitchInEffect(
      session.card.hardSwitches[request.switchKey],
      await this.roleCards.hiredKeys(),
    );
    const ruling = heldCallRuling(HARD_SWITCH_LABELS[request.switchKey], inEffect, (roleKey) =>
      this.roleCards.roleTitle(roleKey),
    );
    if (ruling.kind === "proceed") return ruling;
    if (ruling.kind === "refuse") return refused(ruling.reason);
    if (await this.spentApprovalIn(thread.id, request.call)) return { kind: "proceed" };
    try {
      const consultant = await this.consultations.put(request.sessionId, {
        kind: "approval",
        person: ruling.person,
        call: request.call,
        context: request.context,
        why: request.why,
      });
      const waitingOn = consultant
        ? `${consultant.name}, in a Consultation on this Task`
        : ruling.person
          ? `the user in place of ${ruling.person}`
          : "the user";
      return { kind: "held", waitingOn };
    } catch (error) {
      if (error instanceof ThreadRefused) return refused(error.message);
      throw error;
    }
  }

  /** Uses up the first approval of this call that was granted and not used yet. */
  private async spentApprovalIn(threadId: string, call: string): Promise<boolean> {
    const question = approvalQuestion(call);
    for (const decision of await this.threads.decisionsIn(threadId)) {
      const chosen =
        decision.answer?.kind === "option" ? decision.options[decision.answer.option] : undefined;
      if (decision.question === question && chosen === APPROVAL_OPTIONS[0]) {
        if (await this.threads.spendApproval(decision.id)) return true;
      }
    }
    return false;
  }
}

function refused(reason: string): HeldCallOutcome {
  return { kind: "refused", reason };
}
