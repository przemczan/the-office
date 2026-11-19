import type { Check } from "../../check.ts";
import type { ItemNotification } from "../../codex/protocol.ts";
import { prepareRunningCommand, RUNNING_COMMAND } from "../engine/running-command.ts";
import { RUN_COMMAND_PROMPT, runningCommandUnderWay } from "./interrupt.ts";
import { commandItems, itemStatuses, turnEnding } from "./observations.ts";

const WORD = "STEERED";

/**
 * Barge-in on the Codex engine (spec §2.4, the `bargeIn` capability): `turn/steer` while the turn's
 * command runs reaches the running turn without stopping the command, and the turn reads it.
 */
export const codexBargeInCheck: Check = {
  id: "codex.barge-in",
  title: "turn/steer reaches the running turn without stopping its command",
  async run({ sandbox, startCodexSession }) {
    const repository = await sandbox.createRepository();
    await prepareRunningCommand(repository);
    const session = await startCodexSession({ repository });
    await session.startThread();
    const started = await session.startTurn(RUN_COMMAND_PROMPT);
    await runningCommandUnderWay(session);
    const steer = await session
      .request("turn/steer", {
        threadId: session.threadId,
        expectedTurnId: started.id,
        input: [
          {
            type: "text",
            text: `Once the command has finished, reply with just ${WORD} instead of OK.`,
            text_elements: [],
          },
        ],
      })
      .then(
        () => "accepted",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    const turn = await session.nextTurnEnd();
    const userMessages = session
      .completedItems(started.id)
      .filter((item) => item.type === "userMessage");
    const startedTurns = session.messages.filter((message) => message.method === "turn/started");
    return {
      steer,
      turnEnded: turnEnding(turn),
      sameTurn: startedTurns.length === 1,
      steerInTurn: userMessages.length > 1,
      commandItemStatuses: itemStatuses(commandItems(session, RUNNING_COMMAND, started.id)),
      steerRead: session.finalMessage(started.id)?.toUpperCase().includes(WORD) ?? false,
      commandStartedOnce:
        session.messages.filter(
          (message) =>
            message.method === "item/started" &&
            (message.params as ItemNotification).item.type === "commandExecution",
        ).length === 1,
    };
  },
};
