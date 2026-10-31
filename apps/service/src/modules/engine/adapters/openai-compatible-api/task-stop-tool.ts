import { z } from "zod";
import type { BackgroundCommands, BackgroundStop } from "./background-commands.js";
import {
  builtInTool,
  failure,
  success,
  type BuiltInTool,
  type ToolOutput,
} from "./built-in-tool.js";

const taskStopInput = z.object({
  task_id: z.string().min(1).describe("The ID of the background task to stop"),
});

/** Claude Code's TaskStop: ends a background command with every process it started. */
export function taskStopTool(backgroundCommands: BackgroundCommands): BuiltInTool {
  return builtInTool({
    name: "TaskStop",
    description: "Stops a running background task by its ID, with every process it started.",
    input: taskStopInput,
    run: async ({ task_id }) => stopOutput(task_id, await backgroundCommands.stop(task_id)),
  });
}

function stopOutput(id: string, stop: BackgroundStop): ToolOutput {
  switch (stop.kind) {
    case "stopped":
      return success(`Successfully stopped task: ${id} (${stop.commandLine})`);
    case "not-running":
      return failure(
        `Task ${id} is not running; it ended with exit code ${stop.exitCode ?? "none"}.`,
      );
    case "unknown":
      return failure(`No task found with ID: ${id}`);
  }
}
