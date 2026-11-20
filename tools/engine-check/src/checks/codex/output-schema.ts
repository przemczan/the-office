import type { Check } from "../../check.ts";
import { turnEnding } from "./observations.ts";

const ANSWER_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string", enum: ["OK"] } },
  required: ["answer"],
  additionalProperties: false,
};

/**
 * A Stage answer held to a JSON Schema on the Codex engine (spec §5.4, the `outputSchema`
 * capability): `turn/start`'s `outputSchema`, the app-server's form of `codex exec --output-schema`.
 */
export const codexOutputSchemaCheck: Check = {
  id: "codex.output-schema",
  title: "a turn's final message is held to turn/start's outputSchema",
  async run({ sandbox, startCodexSession }) {
    const session = await startCodexSession({ repository: await sandbox.createRepository() });
    await session.startThread();
    const started = await session.startTurn("Answer OK.", { outputSchema: ANSWER_SCHEMA });
    const turn = await session.nextTurnEnd();
    return {
      turnEnded: turnEnding(turn),
      finalMessageMatches: parsesTo(session.finalMessage(started.id), { answer: "OK" }),
    };
  },
};

function parsesTo(text: string | undefined, expected: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(text ?? "")) === JSON.stringify(expected);
  } catch {
    return false;
  }
}
