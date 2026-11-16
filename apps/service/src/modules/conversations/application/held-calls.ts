import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ApprovalCall } from "../../engine/index.js";
import {
  hardSwitchInEffect,
  HARD_SWITCH_LABELS,
  RoleCards,
  type HardSwitchKey,
  type HardSwitchValue,
} from "../../people/index.js";
import { APPROVAL_OPTIONS, approvalQuestion } from "../domain/consult.js";
import { isApproval, onlyChoice } from "../domain/decision.js";
import { heldCallRuling } from "../domain/held-call.js";
import { mcpToolCallWords } from "../domain/mcp-tool-call.js";
import type { Thread } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ApprovalHolds } from "./approval-holds.js";
import { Consultations } from "./consultations.js";

/**
 * What becomes of a call behind a Hard switch: it runs now, as made by the person filling `roleKey`,
 * is refused, or waits on approval.
 */
export type HeldCallOutcome =
  | { readonly kind: "proceed"; readonly roleKey: string }
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

/** What a held call is put to the approver with, behind whichever setting holds it. */
type HeldCall = Omit<HeldCallRequest, "switchKey">;

/**
 * Holds the calls behind the enforced Hard switches and the MCP tools' settings, which are set the
 * same way (spec §6). The setting decides: Allowed runs, Never refuses, Ask me and Consult open an
 * approval for the call, of the Consultant a Consult names, or of the user. Nothing waits in the
 * tool call: the answer comes as the Agent's next message, and its repeat of the call then runs
 * once if the answer was "Allow once". In a chat no Decision opens, so such a call is refused.
 */
@Injectable()
export class HeldCalls implements OnModuleInit {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly threads: ThreadRepository,
    private readonly consultations: Consultations,
    private readonly approvalHolds: ApprovalHolds,
  ) {}

  onModuleInit(): void {
    this.approvalHolds.holdWith((sessionId, call) => this.holdMcpToolCall(sessionId, call));
  }

  /** A call behind the switch on the calling person's card as it is now. */
  async hold(request: HeldCallRequest): Promise<HeldCallOutcome> {
    const thread = await this.threads.findBySession(request.sessionId);
    if (!thread) return refused("The Office doesn't know this session's Thread.");
    const session = await this.roleCards.find(thread.roleKey);
    if (!session) return refused("Nobody fills your Role now.");
    return this.holdBehind(
      thread,
      request,
      HARD_SWITCH_LABELS[request.switchKey],
      session.card.hardSwitches[request.switchKey],
    );
  }

  /**
   * A call of an MCP tool whose setting, as the session was given it, asks for approval: undefined
   * when it runs now, else the words the Agent reads instead of the tool's answer.
   */
  async holdMcpToolCall(sessionId: string, call: ApprovalCall): Promise<string | undefined> {
    const thread = await this.threads.findBySession(sessionId);
    if (!thread) return "The Office doesn't know this session's Thread.";
    const tool = `the ${call.server}/${call.tool} MCP tool`;
    const outcome = await this.holdBehind(
      thread,
      {
        sessionId,
        call: mcpToolCallWords(call),
        context: `Your Role card asks for approval of each call of ${tool}.`,
        why: `${tool} needs approval for each call.`,
      },
      tool,
      call.setting,
    );
    switch (outcome.kind) {
      case "proceed":
        return undefined;
      case "refused":
        return outcome.reason;
      case "held":
        return `The call waits on ${outcome.waitingOn}, as a Decision in this Thread. End your turn now: their answer comes as your next message, and after "Allow once" you make the same call, with the same input, which then runs once.`;
    }
  }

  private async holdBehind(
    thread: Thread,
    request: HeldCall,
    label: string,
    setting: HardSwitchValue,
  ): Promise<HeldCallOutcome> {
    const inEffect = hardSwitchInEffect(setting, await this.roleCards.hiredKeys());
    const ruling = heldCallRuling(label, inEffect, (roleKey) => this.roleCards.roleTitle(roleKey));
    const proceed: HeldCallOutcome = { kind: "proceed", roleKey: thread.roleKey };
    if (ruling.kind === "proceed") return proceed;
    if (ruling.kind === "refuse") return refused(ruling.reason);
    if (await this.spentApprovalIn(thread.id, request.call)) return proceed;
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
      const choice = onlyChoice(decision);
      const given = decision.answer?.kind === "submitted" ? decision.answer.answers[0] : undefined;
      const chosen = given?.kind === "option" ? choice?.options[given.option] : undefined;
      if (isApproval(decision) && choice?.question === question && chosen === APPROVAL_OPTIONS[0]) {
        if (await this.threads.spendApproval(decision.id)) return true;
      }
    }
    return false;
  }
}

function refused(reason: string): HeldCallOutcome {
  return { kind: "refused", reason };
}
