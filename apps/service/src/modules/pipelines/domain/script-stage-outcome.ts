import { howItEnded, type CommandRun } from "./stage-command-run.js";
import type { StageOutcome } from "./stage-run.js";

/**
 * How a Script Stage ended from its command's runs (spec §2.3): done when the last run passed, a
 * passing re-run telling of a flake, else failed with what the last run printed, which an
 * on-failure loop hands to the Agent that fixes it.
 */
export function scriptStageOutcome(runs: readonly CommandRun[]): StageOutcome {
  const last = runs.at(-1);
  if (!last) throw new Error("A Script Stage's command ran no times.");
  // The Project has no such command yet, so nothing ran: its output says how to set it.
  if (last.commandLine === "") return { status: "failed", error: last.output };
  const command = `\`${last.commandLine}\``;
  if (last.outcome === "passed") {
    return {
      status: "done",
      summary:
        runs.length > 1
          ? `${command} failed, then passed when The Office ran it once more: a flake.`
          : `${command} passed.`,
    };
  }
  const again = runs.length > 1 ? " on its re-run too" : "";
  return { status: "failed", error: `${command} ${howItEnded(last)}${again}.${printed(last)}` };
}

/** A failed install before a Stage, in words for the Stage's failure or the Agent's Brief. */
export function installFailure(run: CommandRun): string {
  return `Installing the Project's dependencies failed: \`${run.commandLine}\` ${howItEnded(run)}.${printed(run)}`;
}

function printed({ output }: CommandRun): string {
  return output.trim() === "" ? "" : `\n\nWhat it printed:\n\n\`\`\`\n${output.trim()}\n\`\`\``;
}
