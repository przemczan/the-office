import { setTimeout as delay } from "node:timers/promises";
import type { Check } from "../../check.ts";
import type { CodexSession } from "../../codex/codex-session.ts";
import type { ItemNotification } from "../../codex/protocol.ts";
import {
  commandRanToItsEnd,
  prepareRunningCommand,
  RUNNING_COMMAND,
  UNDER_WAY_MS,
} from "../engine/running-command.ts";
import { commandItems, itemStatuses, turnEnding } from "./observations.ts";

export const RUN_COMMAND_PROMPT =
  `Run \`${RUNNING_COMMAND}\` in the shell and wait for it to finish; it takes about 30 seconds. ` +
  `Do not run it in the background. Then reply with just OK.`;

/** Waits until the running command is under way on the session's turn. */
export async function runningCommandUnderWay(session: CodexSession): Promise<void> {
  await session.waitFor<ItemNotification>(
    "item/started",
    ({ item }) =>
      item.type === "commandExecution" &&
      (item as { command: string }).command.includes(RUNNING_COMMAND),
  );
  await delay(UNDER_WAY_MS);
}

/**
 * Stop on the Codex engine (spec §2.4, §5.4): `turn/interrupt` while the turn's command runs ends the
 * turn as interrupted, whether the command ends with it, and whether the next turn on the thread
 * runs; then the same command in a new session whose app-server is closed under it, to see whether
 * ending the process ends the command.
 */
export const codexInterruptCheck: Check = {
  id: "codex.interrupt",
  title:
    "turn/interrupt stops the running turn, and the thread continues; the command ends with it or with the app-server",
  timeoutMs: 8 * 60 * 1000,
  async run({ sandbox, startCodexSession, signal }) {
    const repository = await sandbox.createRepository();
    await prepareRunningCommand(repository);
    const session = await startCodexSession({ repository });
    await session.startThread();
    const started = await session.startTurn(RUN_COMMAND_PROMPT);
    await runningCommandUnderWay(session);
    const interruptedAt = Date.now();
    await session.interrupt(started.id);
    const interrupted = await session.nextTurnEnd();
    const answeredIn = Date.now() - interruptedAt;

    await session.startTurn("Reply with just OK.");
    const continued = await session.nextTurnEnd();
    const ranOnAfterInterrupt = await commandRanToItsEnd(repository, interruptedAt, signal);

    const closedRepository = await sandbox.createRepository("repository-closed");
    await prepareRunningCommand(closedRepository);
    const closed = await startCodexSession({ repository: closedRepository });
    await closed.startThread();
    await closed.startTurn(RUN_COMMAND_PROMPT);
    await runningCommandUnderWay(closed);
    const closedAt = Date.now();
    await closed.close();
    const closedIn = Date.now() - closedAt;
    return {
      interruptedTurnEnded: turnEnding(interrupted),
      endedWithinTenSeconds: answeredIn < 10_000,
      nextTurnEnded: turnEnding(continued),
      // Read after the command's run time, as its item may complete after the turn ended.
      commandItemStatuses: itemStatuses(commandItems(session, RUNNING_COMMAND, started.id)),
      commandRanToItsEndAfterInterrupt: ranOnAfterInterrupt,
      appServerEndedOnClosedInput: closedIn < 10_000,
      commandRanToItsEndAfterClose: await commandRanToItsEnd(closedRepository, closedAt, signal),
    };
  },
};
