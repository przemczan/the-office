import type { Check } from "../../check.ts";
import { turnEnding } from "../engine/running-command.ts";
import { rateLimitEvents } from "./observations.ts";

const ANSWER_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string", enum: ["OK"] } },
  required: ["answer"],
  additionalProperties: false,
};

/**
 * A turn held to a JSON Schema by `--json-schema` (spec §5.4, the `outputSchema` capability), and the
 * `rate_limit_event` the turn streams for the usage windows.
 */
export const fallbackOutputSchemaCheck: Check = {
  id: "fallback.output-schema",
  title: "a turn's output is held to --json-schema, and the turn streams rate_limit_event",
  async run({ sandbox, startClaudeCodePSession }) {
    const session = await startClaudeCodePSession({
      repository: await sandbox.createRepository(),
      jsonSchema: ANSWER_SCHEMA,
    });
    session.send("Answer OK.");
    const result = await session.nextResult();
    const structured = result.subtype === "success" ? result.structured_output : undefined;
    return {
      turnEnded: turnEnding(result),
      structuredOutput: JSON.stringify(structured) === JSON.stringify({ answer: "OK" }),
      rateLimitEvents: rateLimitEvents(session.messages),
    };
  },
};
