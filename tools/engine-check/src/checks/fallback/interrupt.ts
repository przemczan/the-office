import type { SDKControlInterruptResponse } from "@anthropic-ai/claude-agent-sdk";
import type { Check } from "../../check.ts";
import type { ClaudeCodePSession } from "../../claude-code-p/claude-code-p-session.ts";
import {
  allowRunningCommandThen,
  commandRanToItsEnd,
  observeRunningCommand,
  prepareRunningCommand,
  RUN_COMMAND_PROMPT,
  turnEnding,
} from "../engine/running-command.ts";

const SMALL_TURN = "Reply with just OK.";

/**
 * Stop and resume on the fallback (spec §2.4, §5.4), as `engine.interrupt` checks them on the SDK:
 * an `interrupt` control request while the turn's command runs, a next turn in the same process,
 * then a new process with `--resume`.
 */
export const fallbackInterruptCheck: Check = {
  id: "fallback.interrupt",
  title:
    "an interrupt request stops the running turn, and the session continues and can be resumed",
  async run({ sandbox, startClaudeCodePSession, signal }) {
    const repository = await sandbox.createRepository();
    await prepareRunningCommand(repository);
    let receipt: Promise<SDKControlInterruptResponse | undefined> | undefined;
    let interruptedAt = Date.now();
    const session = await startClaudeCodePSession({
      repository,
      hooks: {
        PreToolUse: allowRunningCommandThen<ClaudeCodePSession>((running) => {
          interruptedAt = Date.now();
          receipt = running.interrupt();
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

    const resumed = await startClaudeCodePSession({ repository, resume: session.sessionId });
    resumed.send(SMALL_TURN);
    const afterResume = await resumed.nextResult();
    return {
      receiptCapabilityAdvertised: init.capabilities?.includes("interrupt_receipt_v1") ?? false,
      receiptListsStillQueued: Array.isArray(answer?.still_queued),
      interruptedTurnEnded: turnEnding(interrupted),
      command: observeRunningCommand(session),
      nextTurnInSameProcess: turnEnding(continued),
      resumed: {
        turnEnded: turnEnding(afterResume),
        sameSession: afterResume.session_id === session.sessionId,
      },
      commandRanToItsEnd: await commandRanToItsEnd(repository, interruptedAt, signal),
    };
  },
};
