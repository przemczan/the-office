import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { OfficeToolChangedField, OfficeToolRuled } from "../../engine/index.js";
import {
  hardSwitchInEffect,
  HARD_SWITCH_LABELS,
  RoleCards,
  type HardSwitchKey,
  type HardSwitchValue,
} from "../../people/index.js";
import { APPROVAL_OPTIONS, approvalQuestion } from "../domain/consult.js";
import { isApproval, onlyChoice, type Decision, type HeldCallCard } from "../domain/decision.js";
import { heldCallRuling } from "../domain/held-call.js";
import { mcpToolCallWords } from "../domain/mcp-tool-call.js";
import type { Thread } from "../domain/thread.js";
import type { UserRef } from "../domain/user.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ApprovalHolds, type HeldMcpToolCall } from "./approval-holds.js";
import { Consultations } from "./consultations.js";

/**
 * What becomes of a call behind a Hard switch: it runs now, as made by the person filling `roleKey`
 * and allowed by `allowedBy` when it used up a user's approval, is refused, or waits on approval.
 */
export type HeldCallOutcome =
  | { readonly kind: "proceed"; readonly roleKey: string; readonly allowedBy?: UserRef }
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
  /** The fields a call of an Office action changes, which the approval's card lists. */
  readonly fields?: readonly OfficeToolChangedField[];
  /** The call in words for the approval card; its key is `call`. */
  readonly card?: Omit<HeldCallCard, "key">;
}

/** What a held call is put to the approver with, behind whichever setting holds it. */
export type HeldCall = Omit<HeldCallRequest, "switchKey">;

/**
 * Holds the calls behind the enforced Hard switches, each its named group of the caller's Authority
 * (Proposal read as Never), and the MCP tools' settings, which are set the same way (spec §6). The
 * setting decides: Allowed runs, Never refuses, Ask me and Consult open an
 * approval for the call, of the Consultant a Consult names, or of the user. Nothing waits in the
 * tool call: the answer comes as the Agent's next message, and its repeat of the call then runs
 * once if the answer was "Allow once". In a person's chat the user's approval waits inline there
 * (spec §2.7); where no Decision opens, as in a Consultation, such a call is refused.
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

  /** A call behind the named group of the calling person's Authority as it is now. */
  async hold(request: HeldCallRequest): Promise<HeldCallOutcome> {
    const thread = await this.threads.findBySession(request.sessionId);
    if (!thread) return refused("The Office doesn't know this session's Thread.");
    const session = await this.roleCards.find(thread.roleKey);
    if (!session) return refused("Nobody fills your Role now.");
    return this.holdBehind(
      thread,
      request,
      HARD_SWITCH_LABELS[request.switchKey],
      session.hardSwitches[request.switchKey],
    );
  }

  /**
   * A call of an Office tool whose Authority setting, as ruled for this call, holds it for approval
   * (`toolRuling`): it runs now, with the user whose approval it used up, or it is held in the
   * words the Agent reads instead of the tool's answer. The approval is of this person in this
   * Thread for this `call`, which the caller words in canonical form; it covers one run.
   */
  async holdToolCall(
    sessionId: string,
    tool: string,
    setting: HardSwitchValue,
    request: HeldCall,
  ): Promise<OfficeToolRuled> {
    const thread = await this.threads.findBySession(sessionId);
    if (!thread) return { kind: "hold", words: "The Office doesn't know this session's Thread." };
    const outcome = await this.holdBehind(thread, request, tool, setting);
    const words = heldCallWords(outcome);
    if (words !== undefined) return { kind: "hold", words };
    return outcome.kind === "proceed" && outcome.allowedBy
      ? { kind: "run", allowedBy: outcome.allowedBy }
      : { kind: "run" };
  }

  /**
   * A call of an MCP tool whose setting, as the session was given it, asks for approval: undefined
   * when it runs now, else the words the Agent reads instead of the tool's answer.
   */
  async holdMcpToolCall(sessionId: string, call: HeldMcpToolCall): Promise<string | undefined> {
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
        card: {
          action: `${call.tool} (MCP server ${call.server})`,
          description: call.description,
          input: call.input,
          callAsSent: { server: call.server, tool: call.tool, input: call.input },
        },
      },
      tool,
      call.setting,
    );
    return heldCallWords(outcome);
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
    const spent = await this.spentApprovalIn(thread.id, request.call);
    if (spent) return spent.allowedBy ? { ...proceed, allowedBy: spent.allowedBy } : proceed;
    try {
      const consultant = await this.consultations.put(request.sessionId, {
        kind: "approval",
        person: ruling.person,
        call: request.call,
        context: request.context,
        why: request.why,
        ...(request.fields && { fields: request.fields }),
        ...(request.card && { heldCall: { key: request.call, ...request.card } }),
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

  /** Uses up the first approval of this call that was granted and not used yet, if there is one. */
  private async spentApprovalIn(
    threadId: string,
    call: string,
  ): Promise<SpentApproval | undefined> {
    const question = approvalQuestion(call);
    for (const decision of await this.threads.decisionsIn(threadId)) {
      const choice = onlyChoice(decision);
      const given = decision.answer?.kind === "submitted" ? decision.answer.answers[0] : undefined;
      const chosen = given?.kind === "option" ? choice?.options[given.option] : undefined;
      const asksForCall = choice?.heldCall
        ? choice.heldCall.key === call
        : choice?.question === question;
      if (isApproval(decision) && asksForCall && chosen === APPROVAL_OPTIONS[0]) {
        if (await this.threads.spendApproval(decision.id)) {
          return { allowedBy: userWhoAllowed(decision) };
        }
      }
    }
    return undefined;
  }
}

/** An approval a call used up, with the user who gave it, if a user did. */
interface SpentApproval {
  readonly allowedBy: UserRef | undefined;
}

/** The user who gave an approval: themselves, or by a person they asked; none for a Consultant. */
function userWhoAllowed({ answer }: Decision): UserRef | undefined {
  return answer?.user ?? answer?.atUsersRequest?.user ?? undefined;
}

/** What the Agent reads of a held call's outcome: nothing when it runs now. */
function heldCallWords(outcome: HeldCallOutcome): string | undefined {
  switch (outcome.kind) {
    case "proceed":
      return undefined;
    case "refused":
      return outcome.reason;
    case "held":
      return `The call waits on ${outcome.waitingOn}, as a Decision in this Thread. End your turn now: their answer comes as your next message, and after "Allow once" you make the same call, with the same input, which then runs once.`;
  }
}

function refused(reason: string): HeldCallOutcome {
  return { kind: "refused", reason };
}
