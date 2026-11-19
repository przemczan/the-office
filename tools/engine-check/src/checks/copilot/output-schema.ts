import { defineTool, type SessionEvent } from "@microsoft/copilot-sdk";
import type { Check } from "../../check.ts";
import { eventsOfType, lastAnswer } from "../../copilot-cli/events.ts";

const SCHEMA = {
  type: "object",
  properties: { answer: { type: "integer" } },
  required: ["answer"],
  additionalProperties: false,
} as const;
const QUESTION = "What is 19 + 23?";
const SUBMIT_TOOL = "submit_result";

/** Whether `value` is the schema's answer: exactly `{ answer: 42 }`. */
function matches(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    (value as { answer?: unknown }).answer === 42
  );
}

function parsed(text: string): { readonly json: boolean; readonly value: unknown } {
  try {
    return { json: true, value: JSON.parse(text) as unknown };
  } catch {
    return { json: false, value: undefined };
  }
}

/** The kind of an error, never its text: its class name, and its JSON-RPC code when it has one. */
function errorKind(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error;
  }
  const code = (error as { code?: unknown }).code;
  return code === undefined ? error.name : `${error.name}:${String(code)}`;
}

/** Whether the turn ended with the submit call: no model call or answer came after its completion. */
function endedAfterSubmit(events: readonly SessionEvent[]): boolean {
  const completion = events.findLastIndex(
    (event) =>
      event.type === "tool.execution_complete" &&
      eventsOfType(events, "tool.execution_start").some(
        (start) =>
          start.data.toolCallId === event.data.toolCallId && start.data.toolName === SUBMIT_TOOL,
      ),
  );
  return (
    completion !== -1 &&
    !events
      .slice(completion + 1)
      .some(
        (event) => event.type === "assistant.turn_start" || event.type === "tool.execution_start",
      )
  );
}

/**
 * Structured output on the Copilot engine: whether a turn sent with `responseSchema` (a raw JSON
 * Schema) answers JSON that matches it, and the stand-in for when it doesn't: an Office tool marked
 * `isTerminal` that takes the schema as its parameters, whose call ends the turn.
 */
export const copilotOutputSchemaCheck: Check = {
  id: "copilot.output-schema",
  title: "responseSchema shapes the answer, and a terminal submit tool stands in for it",
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const submitted: unknown[] = [];
    const session = await startCopilotSession({
      repository,
      officeTools: [
        defineTool(SUBMIT_TOOL, {
          description: "Submits the Stage's result to The Office; the last thing you do.",
          parameters: SCHEMA,
          isTerminal: true,
          handler: (args) => {
            submitted.push(args);
            return "Submitted.";
          },
        }),
      ],
    });
    const native = await session
      .turn(`${QUESTION} Answer as the response format asks. Use no tools.`, {
        responseSchema: SCHEMA,
      })
      .then(
        (events) => {
          const answer = parsed(lastAnswer(events));
          return { native: true, json: answer.json, matches: matches(answer.value) };
        },
        (error: unknown) => ({ native: false, error: errorKind(error) }),
      );
    const submitEvents = await session.turn(
      `${QUESTION} Give your answer only by calling the ${SUBMIT_TOOL} tool once with it.`,
    );
    return {
      responseSchema: native,
      submitTool: {
        called: submitted.length > 0,
        argumentsMatch: submitted.length > 0 && submitted.every(matches),
        turnEndedAfterIt: endedAfterSubmit(submitEvents),
      },
    };
  },
};
