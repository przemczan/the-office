import {
  CAPTURE_IDEA_TOOL,
  DECISION_TOOLS,
  POST_LINK_CARD_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_ROLE_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL,
  SHOW_OFFICE_STATUS_TOOL,
  type Message,
} from "@the-office/contracts";
import type { ToolCall } from "./message-groups.ts";

/** A card shows its tool's call, so the call's activity line is left out. */
const TOOLS_SHOWN_AS_CARDS: readonly string[] = [
  ...DECISION_TOOLS,
  PROPOSE_ROLE_TOOL,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL,
  POST_LINK_CARD_TOOL,
  CAPTURE_IDEA_TOOL,
  SHOW_OFFICE_STATUS_TOOL,
];

/** A kind added to the contract fails to compile here, so someone decides where it belongs. */
const SHOWS: { readonly [Kind in Message["kind"]]: "always" | "with-details" } = {
  user: "always",
  person: "always",
  "handover-note": "always",
  "tool-activity": "with-details",
  context: "with-details",
  "changes-allowed": "always",
  failure: "always",
  held: "always",
  decision: "always",
  "decision-answer": "always",
  proposal: "always",
  "link-card": "always",
  idea: "always",
  "office-status": "always",
  refusal: "always",
  "mcp-server-not-started": "always",
};

/**
 * What a Thread's log shows, with the Details switch on or off. Only what is marked hides: a kind
 * this build doesn't know yet, from a newer service, still shows.
 */
export function visibleMessages(messages: readonly Message[], details: boolean): Message[] {
  return messages.filter(
    (message) => !isCardsToolCall(message) && (details || SHOWS[message.kind] !== "with-details"),
  );
}

/**
 * Whether the Details switch alone leaves a Thread's log empty, so it says why: a Thread with no
 * messages, or one where the person is answering, has nothing to explain.
 */
export function onlyDetailsWouldShow(
  messages: readonly Message[],
  details: boolean,
  answering: boolean,
): boolean {
  return (
    !details &&
    !answering &&
    visibleMessages(messages, false).length === 0 &&
    visibleMessages(messages, true).length > 0
  );
}

/** The tool call that says what the person is doing now, while Details hides the log's own. */
export function latestToolCall(messages: readonly Message[]): ToolCall | undefined {
  return messages
    .filter(isToolCall)
    .filter((call) => !isCardsToolCall(call))
    .at(-1);
}

function isToolCall(message: Message): message is ToolCall {
  return message.kind === "tool-activity";
}

function isCardsToolCall(message: Message): boolean {
  return isToolCall(message) && TOOLS_SHOWN_AS_CARDS.includes(message.tool);
}
