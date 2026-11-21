import { howItEnded, type CommandRun } from "./stage-command-run.js";
import type { StageOutcome } from "./stage-run.js";

/**
 * How a Script Stage ended from its command's runs (spec §2.3): done when the last run passed, a
 * passing re-run command telling of a flake, else failed with what the last run printed, which an
 * on-failure loop hands to the Agent that fixes it. A second run is the test command's re-run
 * command (spec §5.5), so both lines are named.
 */
export function scriptStageOutcome(runs: readonly CommandRun[]): StageOutcome {
  const first = runs.at(0);
  const last = runs.at(-1);
  if (!first || !last) throw new Error("A Script Stage's command ran no times.");
  // The Project lacks the command or hasn't set it, so nothing ran: its output says how to set it.
  if (last.commandLine === "") return { status: "failed", error: last.output };
  const command = `\`${first.commandLine}\``;
  if (runs.length === 1) {
    return last.outcome === "passed"
      ? { status: "done", summary: `${command} passed.` }
      : { status: "failed", error: `${command} ${howItEnded(last)}.${printed(last)}` };
  }
  const rerun = `its re-run command \`${last.commandLine}\``;
  if (last.outcome === "passed") {
    return {
      status: "done",
      summary: `${command} failed, then passed when The Office ran ${rerun}: a flake.`,
    };
  }
  return {
    status: "failed",
    error: `${command} failed, and ${rerun} ${howItEnded(last)} too.${printed(last)}`,
  };
}

/** A failed install before a Stage, in words for the Stage's failure or the Agent's Brief. */
export function installFailure(run: CommandRun): string {
  return `Installing the Project's dependencies failed: \`${run.commandLine}\` ${howItEnded(run)}.${printed(run)}`;
}

function printed({ output }: CommandRun): string {
  return output.trim() === "" ? "" : `\n\nWhat it printed:\n\n\`\`\`\n${output.trim()}\n\`\`\``;
}
