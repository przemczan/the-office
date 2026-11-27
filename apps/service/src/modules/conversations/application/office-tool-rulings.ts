import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  OfficeToolRegistry,
  type OfficeToolCall,
  type OfficeToolRuled,
  type OfficeToolRuling,
} from "../../engine/index.js";
import {
  ASK_ME,
  authorityRow,
  heldToCap,
  isAuthorityGroup,
  RoleCards,
  type AuthorityGroup,
  type HardSwitchValue,
} from "../../people/index.js";
import type { Thread } from "../domain/thread.js";
import {
  atLeastProposal,
  officeToolCallWords,
  ownWorkValue,
  strictestValue,
  toolRuling,
  valueOnSubject,
} from "../domain/office-tool-ruling.js";
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
 * the call, on the call's subject, own work or others'. A call the tool's own check refuses is
 * refused before it runs, is held or is drafted, and a held call's card lists the tool's approval
 * lines.
 */
@Injectable()
export class OfficeToolRulings implements OfficeToolRuling, OnModuleInit {
  constructor(
    private readonly threads: ThreadRepository,
    private readonly roleCards: RoleCards,
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
    call: OfficeToolCall,
    { name, authority }: Parameters<OfficeToolRuling["rule"]>[1],
    input: unknown,
  ): Promise<OfficeToolRuled> {
    const { sessionId } = call;
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
    const subject = authority.subject(input);
    // A Stage works on its own Task only: its Authority over other work is for its other Threads.
    if (thread.stageThread && subject.kind === "task" && subject.id !== taskOf(thread)) {
      return hold(
        `${name} acts on this Stage's own Task only. Ask the user to do it from another Thread.`,
      );
    }
    const setting = session.authority[authority.group];
    const ownWorkGroup = authority.onOwnWork;
    if (ownWorkGroup !== undefined && !isAuthorityGroup(ownWorkGroup)) {
      throw new Error(
        `${name} names the Authority group ${ownWorkGroup}, which isn't in the catalog.`,
      );
    }
    // A tool with a row of its own on own work reads that row there, held to its cap.
    const ownWork =
      (ownWorkGroup !== undefined || setting.kind === "own-and-others") &&
      (await this.work.isOwnWork(thread.roleKey, subject));
    const value =
      ownWork && ownWorkGroup !== undefined
        ? ownWorkValue(ownWorkGroup, session.authority[ownWorkGroup])
        : valueOnSubject(setting, ownWork);
    const touched = await this.touchedGroups(name, authority.group, authority.groupsOf, input);
    const touchedValues = touched.map(({ group }) => ({
      group,
      value:
        group === authority.group
          ? value
          : heldToCap(group, valueOnSubject(session.authority[group], ownWork)),
    }));
    // A call is ruled by the strictest group of the sections it touches; one at Never is refused up
    // front, naming it, unless it is the tool's own group, which makes the tool unoffered.
    const neverGroup = touchedValues.find(({ value: each }) => each.kind === "never");
    if (neverGroup && neverGroup.group !== authority.group) {
      return hold(
        `${authorityRow(neverGroup.group).label} is Never on your Role card, and this call touches it: leave that section out, or ask the user to change it.`,
      );
    }
    const floored = (await authority.floor?.(input)) === "proposal";
    const strictest = strictestValue(touchedValues.map(({ value: each }) => each));
    const ruling = toolRuling(floored ? atLeastProposal(strictest) : strictest);
    if (ruling.kind === "never") return { kind: "never" };
    // Asked at every outcome but Never, so a repeat after Allow once meets the state of its own time.
    const refused = await authority.check?.(input, call);
    if (refused !== undefined) return hold(refused);
    if (ruling.kind === "run") return { kind: "run" };
    if (ruling.kind === "propose") {
      const proposed = await this.propose(sessionId, authority.title, name, input);
      // A tool with no draft can't be proposed: it is held as Ask me.
      return proposed ?? this.holdForApproval(call, name, authority, input, ASK_ME);
    }
    return this.holdForApproval(call, name, authority, input, ruling.setting);
  }

  /** The groups a call touches: its tool's own, and those its tool says its input touches too. */
  private async touchedGroups(
    name: string,
    own: string,
    groupsOf: ((input: unknown) => Promise<readonly string[]>) | undefined,
    input: unknown,
  ): Promise<{ group: AuthorityGroup }[]> {
    const keys = new Set([own, ...((await groupsOf?.(input)) ?? [])]);
    return [...keys].map((group) => {
      if (!isAuthorityGroup(group)) {
        throw new Error(`${name} names the Authority group ${group}, which isn't in the catalog.`);
      }
      return { group };
    });
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
    call: OfficeToolCall,
    name: string,
    authority: NonNullable<Parameters<OfficeToolRuling["rule"]>[1]["authority"]>,
    input: unknown,
    setting: HardSwitchValue,
  ): Promise<OfficeToolRuled> {
    const { sessionId } = call;
    const fields = (await this.registry.draft(name, input).catch(() => undefined))?.fields;
    const lines = (await authority.approvalLines?.(input, call)) ?? [];
    const redacted = await this.registry.redact(name, input);
    return this.heldCalls.holdToolCall(sessionId, name, setting, {
      sessionId,
      call: officeToolCallWords(name, input, redacted.hasSecret ? redacted : undefined),
      context: approvalContext(name, lines),
      why: `${name} needs approval for each call.`,
      ...(fields && { fields }),
    });
  }
}

/** The approval card's words: what the tool says the call changes, one line each, where it says. */
function approvalContext(name: string, lines: readonly string[]): string {
  const asks = `Your Role card asks for approval of each call of ${name}.`;
  if (lines.length === 0) return asks;
  return `${asks} This call changes:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

function taskOf({ home }: Thread): string | undefined {
  return home.kind === "task" ? home.taskId : undefined;
}

function hold(words: string): OfficeToolRuled {
  return { kind: "hold", words };
}
