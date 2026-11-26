import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  OfficeToolRegistry,
  type OfficeToolRuled,
  type OfficeToolRuling,
} from "../../engine/index.js";
import {
  ASK_ME,
  Duties,
  isAuthorityGroup,
  RoleCards,
  type HardSwitchValue,
} from "../../people/index.js";
import { dutyActionTools } from "../domain/duty-action-tools.js";
import { officeToolCallWords, toolRuling, valueOnSubject } from "../domain/office-tool-ruling.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ApprovalHolds } from "./approval-holds.js";
import { HeldCalls } from "./held-calls.js";
import { ProposalService } from "./proposal-service.js";
import { WorkRecords } from "./work-records.js";

/**
 * The ruling every Office tool call passes in a session (spec 5.4.1 › One ruling step), which the
 * registry asks before it runs a tool: Allowed runs it, Consult a person and Ask me hold it as a
 * held call, Proposal drafts it as a Proposal the user applies (the Agent goes on at once), and
 * Never refuses it as an unknown tool. The setting is the person's Authority as it is at
 * the call, on the call's subject, own work or others'.
 */
@Injectable()
export class OfficeToolRulings implements OfficeToolRuling, OnModuleInit {
  constructor(
    private readonly threads: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly duties: Duties,
    private readonly heldCalls: HeldCalls,
    private readonly work: WorkRecords,
    private readonly approvalHolds: ApprovalHolds,
    private readonly registry: OfficeToolRegistry,
    private readonly proposals: ProposalService,
  ) {}

  onModuleInit(): void {
    this.approvalHolds.ruleWith(this);
  }

  async rule(
    { sessionId }: { readonly sessionId: string },
    { name, authority }: Parameters<OfficeToolRuling["rule"]>[1],
    input: unknown,
  ): Promise<OfficeToolRuled> {
    // A tool that isn't an Office action has no setting of its own: it keeps its own checks.
    if (authority === undefined) return { kind: "run" };
    const thread = await this.threads.findBySession(sessionId);
    if (!thread) return hold("The Office doesn't know this session's Thread.");
    const session = await this.roleCards.find(thread.roleKey);
    if (!session) return hold("Nobody fills your Role now.");
    if (!isAuthorityGroup(authority.group)) {
      throw new Error(
        `${name} names the Authority group ${authority.group}, which isn't in the catalog.`,
      );
    }
    const setting = session.authority[authority.group];
    const ownWork =
      setting.kind === "own-and-others" &&
      (await this.work.isOwnWork(thread.roleKey, authority.subject(input)));
    const dutyHolder = dutyActionTools(await this.duties.heldBy(thread.roleKey)).has(name);
    const ruling = toolRuling(valueOnSubject(setting, ownWork), dutyHolder);
    if (ruling.kind === "run") return { kind: "run" };
    if (ruling.kind === "never") return { kind: "never" };
    if (ruling.kind === "propose") {
      const proposed = await this.propose(sessionId, authority.title, name, input);
      // A tool with no draft can't be proposed: it is held as Ask me.
      return proposed ?? this.holdForApproval(sessionId, name, input, ASK_ME);
    }
    return this.holdForApproval(sessionId, name, input, ruling.setting);
  }

  /** Drafts the call as a Proposal and answers it at once; undefined for a tool that has no draft. */
  private async propose(
    sessionId: string,
    title: string,
    name: string,
    input: unknown,
  ): Promise<OfficeToolRuled | undefined> {
    const drafted = await this.registry.draft(name, input);
    if (!drafted) return undefined;
    try {
      await this.proposals.draft(sessionId, {
        kind: "office-action",
        action: name,
        title,
        input: input as Record<string, unknown>,
        ...drafted,
        outOfDate: false,
      });
    } catch (error) {
      if (error instanceof ProposalRefused) return { kind: "answered", words: error.message };
      throw error;
    }
    return {
      kind: "answered",
      words: `Drafted a Proposal: ${title}. The user applies it; go on.`,
    };
  }

  private async holdForApproval(
    sessionId: string,
    name: string,
    input: unknown,
    setting: HardSwitchValue,
  ): Promise<OfficeToolRuled> {
    const fields = (await this.registry.draft(name, input).catch(() => undefined))?.fields;
    return this.heldCalls.holdToolCall(sessionId, name, setting, {
      sessionId,
      call: officeToolCallWords(name, input),
      context: `Your Role card asks for approval of each call of ${name}.`,
      why: `${name} needs approval for each call.`,
      ...(fields && { fields }),
    });
  }
}

function hold(words: string): OfficeToolRuled {
  return { kind: "hold", words };
}
