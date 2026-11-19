import type { Check } from "../../check.ts";
import { filesUnder } from "../observations.ts";
import { answerHolds } from "./helpers.ts";

const WORD = "TANGERINE";

/**
 * Resume on the Copilot engine: a session closed with its runtime process is resumed by its id in a
 * new process on the same config folder, keeps its id and remembers the earlier turn; its files are
 * under the config folder, and the client lists it.
 */
export const copilotResumeCheck: Check = {
  id: "copilot.resume",
  title:
    "a closed session resumes by its id in a new runtime process and remembers its earlier turn",
  async run({ sandbox, copilotHome, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const first = await startCopilotSession({ repository });
    await first.turn(`Remember the word ${WORD} for later. Reply with just OK.`);
    const sessionId = first.sessionId;
    await first.close();
    const resumed = await startCopilotSession({ repository, resume: sessionId });
    const events = await resumed.turn(
      "What word did I ask you to remember? Reply with just the word.",
    );
    const listed = await resumed.client.listSessions();
    return {
      remembered: answerHolds(events, WORD),
      sameSessionId: resumed.sessionId === sessionId,
      sessionFilesInConfigFolder: (await filesUnder(copilotHome)).size > 0,
      listedByClient: listed.some((session) => session.sessionId === sessionId),
    };
  },
};
