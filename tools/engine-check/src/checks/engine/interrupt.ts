import type { SDKControlInterruptResponse } from "@anthropic-ai/claude-agent-sdk";
import type { Check } from "../../check.ts";
import { allowRunningCommandThen, commandRanToItsEnd, observeRunningCommand, prepareRunningCommand, RUN_COMMAND_PROMPT, turnEnding } from "./running-command.ts";

const SMALL_TURN = "Reply with just OK.";

/**
 * Stop (spec §2.4) calls `interrupt()` while the turn's command runs; the Task is held and later
 * continued, in the same `query()` or by resuming the session after its process ended.
 */
export const interruptCheck: Check = {
  id: "engine.interrupt",
  title: "interrupt() stops the running turn, and the session continues and can be resumed",
  async run({ sandbox, startSession, signal }) {
    const repository = await sandbox.createRepository();
    await prepareRunningCommand(repository);
    let receipt: Promise<SDKControlInterruptResponse | undefined> | undefined;
    let interruptedAt = Date.now();
    const session = await startSession({
      repository,
      hooks: {
        PreToolUse: allowRunningCommandThen((running) => {
          interruptedAt = Date.now();
          receipt = running.control.interrupt();
        }),
      },
    });
    session.send(RUN_COMMAND_PROMPT);
    const init = await session.init();
    const interrupted = await session.nextResult();
    const answer = await receipt;

    session.send(SMALL_TURN);
    const continued = await session.nextResult();
    await session.close();

    const resumed = await startSession({ repository, resume: session.sessionId });
    resumed.send(SMALL_TURN);
    const afterResume = await resumed.nextResult();
    return {
      receiptCapabilityAdvertised: init.capabilities?.includes("interrupt_receipt_v1") ?? false,
      receiptListsStillQueued: Array.isArray(answer?.still_queued),
      interruptedTurnEnded: turnEnding(interrupted),
      command: observeRunningCommand(session),
      nextTurnInSameQuery: turnEnding(continued),
      resumed: { turnEnded: turnEnding(afterResume), sameSession: afterResume.session_id === session.sessionId },
      // Ending a shell can leave its child running (spec §5.1 ends a process tree per platform); Stop must end the command.
      commandRanToItsEnd: await commandRanToItsEnd(repository, interruptedAt, signal),
    };
  },
};
