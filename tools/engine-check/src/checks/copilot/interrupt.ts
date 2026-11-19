import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Check } from "../../check.ts";
import { indexOfType } from "../../copilot-cli/events.ts";
import { processRunning } from "../observations.ts";
import { answerHolds } from "./helpers.ts";

const PID_FILE = "pid.txt";
const IDLE_WITHIN_MS = 30_000;

/** The process id the command wrote to `path`, once it has; polls until the check's signal aborts. */
async function writtenProcessId(path: string, signal: AbortSignal): Promise<number> {
  for (;;) {
    const id = Number.parseInt(await readFile(path, "utf8").catch(() => ""), 10);
    if (Number.isInteger(id) && id > 0) {
      return id;
    }
    await delay(250, undefined, { signal });
  }
}

/**
 * Stop on the Copilot engine: `session.abort` while the turn's shell command runs ends the turn
 * (idle, with an `abort` event), whether the command's process ends with it, and whether the next
 * turn on the session runs.
 */
export const copilotInterruptCheck: Check = {
  id: "copilot.interrupt",
  title: "abort stops the running turn and its shell command, and the session takes the next turn",
  platforms: ["linux"],
  async run({ sandbox, startCopilotSession, signal }) {
    const repository = await sandbox.createRepository();
    const session = await startCopilotSession({ repository });
    const from = session.events.length;
    // The runtime's shell tool can keep its shell across calls, which would outlive an abort that ends
    // the command; `exec` makes the written id the sleep's own, not the tool's shell's.
    await session.send(
      `Run exactly this shell command and wait for it to finish: \`sh -c 'echo $$ > ${PID_FILE}; exec sleep 120'\`. ` +
        "Do not run it in the background. Then reply with just OK.",
    );
    const processId = await writtenProcessId(join(repository, PID_FILE), signal);
    await session.interrupt();
    const idle = await Promise.race([
      session.untilIdle(from).then(() => true),
      delay(IDLE_WITHIN_MS, false, { signal }),
    ]);
    await delay(2000, undefined, { signal });
    const commandStillRuns = processRunning(processId);
    const next = idle ? await session.turn("Reply with just OK.") : [];
    return {
      idleWithinThirtySeconds: idle,
      abortEvent: indexOfType(session.events, "abort", from) !== -1,
      commandStillRunsAfterTwoSeconds: commandStillRuns,
      nextTurnAnswered: answerHolds(next, "OK"),
    };
  },
};
