import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionEvent, ToolRefusedEvent } from "../../ports/session-events.js";
import { portToolName } from "../office-rules/office-tool-names.js";

/** For a refusal the engine names no reason for and whose result was not seen. */
const UNKNOWN_REASON = "Refused by the engine.";

/**
 * A session's tool refusals, gathered from where each shows (spec §6): the Office rules hook's own
 * decisions, the engine's `permission_denied` messages, and a turn's `permission_denials`, which
 * also hold the refusals of its input validation. Each is reported once: an Office refusal after
 * the call's result, an engine refusal when its message comes, and what is left before the turn
 * ends.
 */
export class ToolRefusals {
  /** The Office rules' reasons by call id. */
  private readonly byOfficeRules = new Map<string, string>();
  private readonly toolNames = new Map<string, string>();
  /** What a failed call's result said, the engine's reason when it refused the call. */
  private readonly errorTexts = new Map<string, string>();
  private readonly reported = new Set<string>();

  refusedByOfficeRules(callId: string, reason: string): void {
    this.byOfficeRules.set(callId, reason);
  }

  /** The events of one stream message with the refusals it shows, in order. */
  withRefusals(message: SDKMessage, events: readonly SessionEvent[]): SessionEvent[] {
    if (message.type === "result") {
      const left = message.permission_denials.flatMap(({ tool_use_id, tool_name }) =>
        this.report(tool_use_id, tool_name, this.errorTexts.get(tool_use_id) ?? UNKNOWN_REASON),
      );
      return [...left, ...events];
    }
    if (message.type === "system" && message.subtype === "permission_denied") {
      return [...events, ...this.report(message.tool_use_id, message.tool_name, message.message)];
    }
    return events.flatMap((event) => [event, ...this.afterEvent(event)]);
  }

  private afterEvent(event: SessionEvent): ToolRefusedEvent[] {
    if (event.kind === "tool-call") this.toolNames.set(event.callId, event.tool);
    if (event.kind !== "tool-result" || !event.isError) return [];
    this.errorTexts.set(event.callId, event.text);
    return this.byOfficeRules.has(event.callId)
      ? this.report(event.callId, this.toolNames.get(event.callId) ?? "", event.text)
      : [];
  }

  private report(callId: string, engineTool: string, engineReason: string): ToolRefusedEvent[] {
    if (this.reported.has(callId)) return [];
    this.reported.add(callId);
    const officeReason = this.byOfficeRules.get(callId);
    return [
      {
        kind: "tool-refused",
        callId,
        tool: this.toolNames.get(callId) ?? portToolName(engineTool),
        reason: officeReason ?? engineReason,
        refusedBy: officeReason === undefined ? "engine" : "office-rules",
      },
    ];
  }
}
