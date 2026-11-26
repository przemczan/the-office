import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { OfficeToolRuled, OfficeToolRuling } from "../../engine/index.js";
import { Duties, isAuthorityGroup, RoleCards } from "../../people/index.js";
import { dutyActionTools } from "../domain/duty-action-tools.js";
import { officeToolCallWords, toolRuling, valueOnSubject } from "../domain/office-tool-ruling.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ApprovalHolds } from "./approval-holds.js";
import { HeldCalls } from "./held-calls.js";
import { WorkRecords } from "./work-records.js";

/**
 * The ruling every Office tool call passes in a session (spec 5.4.1 › One ruling step), which the
 * registry asks before it runs a tool: Allowed runs it, Consult a person and Ask me hold it as a
 * held call, Never refuses it as an unknown tool. The setting is the person's Authority as it is at
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
    return this.heldCalls.holdToolCall(sessionId, name, ruling.setting, {
      sessionId,
      call: officeToolCallWords(name, input),
      context: `Your Role card asks for approval of each call of ${name}.`,
      why: `${name} needs approval for each call.`,
    });
  }
}

function hold(words: string): OfficeToolRuled {
  return { kind: "hold", words };
}
