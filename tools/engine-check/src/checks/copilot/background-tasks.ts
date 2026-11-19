import type { Check } from "../../check.ts";
import type { CopilotSession } from "../../copilot-cli/copilot-session.ts";
import { fieldNames, indexOfType } from "../../copilot-cli/events.ts";
import { sortedNames } from "../observations.ts";
import { isShellTool, preToolUseCalls, refusal, shellStarts } from "./helpers.ts";

const PROMPT =
  "Start the shell command `sleep 30` in the background (asynchronously, or detached), without waiting " +
  "for it to finish, then reply with just STARTED.";
const BACKGROUND_FIELD = /mode|detach|async|background/iu;

/** The shell input's fields that choose how it runs, with their values when they are plain. */
function backgroundFields(input: unknown): Record<string, string | number | boolean> {
  if (typeof input !== "object" || input === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input)
      .filter(([name]) => BACKGROUND_FIELD.test(name))
      .filter((entry): entry is [string, string | number | boolean] =>
        ["string", "number", "boolean"].includes(typeof entry[1]),
      )
      .toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

/** Whether a shell input asks to run in the background, by the fields the runtime gives it. */
function asksForBackground(input: unknown): boolean {
  return Object.entries(backgroundFields(input)).some(
    ([name, value]) => value === true || (name.toLowerCase() === "mode" && value !== "sync"),
  );
}

async function taskCount(session: CopilotSession): Promise<number> {
  return (await session.sdk.rpc.tasks.list()).tasks.length;
}

/**
 * Background shell commands on the Copilot engine: how a shell call asks to run in the background
 * (its input's fields), whether the session reports a background task, and whether the hook can
 * refuse such a call by those fields, so no background task is left running past the turn.
 */
export const copilotBackgroundTasksCheck: Check = {
  id: "copilot.background-tasks",
  title: "a background shell call shows in its input and the task list, and the hook can refuse it",
  platforms: ["linux"],
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const session = await startCopilotSession({ repository });
    const events = await session.turn(PROMPT);
    const shell = shellStarts(events);
    const tasks = await taskCount(session);

    const refused = await startCopilotSession({ repository });
    refused.decide = ({ toolName, input }) =>
      isShellTool(toolName) && asksForBackground(input)
        ? refusal("The Office runs no background commands; run it in the foreground.")
        : undefined;
    const refusedEvents = await refused.turn(PROMPT);
    return {
      shellInputFields: sortedNames(shell.flatMap((start) => fieldNames(start.input))),
      backgroundFields: backgroundFields(shell[0]?.input),
      backgroundTasksChanged: indexOfType(events, "session.background_tasks_changed") !== -1,
      backgroundTasks: tasks,
      refusal: {
        refused: preToolUseCalls(refused.hookCalls).some(
          (call) => call.answer?.permissionDecision === "deny",
        ),
        backgroundTasksChanged:
          indexOfType(refusedEvents, "session.background_tasks_changed") !== -1,
        backgroundTasks: await taskCount(refused),
      },
    };
  },
};
