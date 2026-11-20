import type { CommandResults, CommandTest, Weight } from "./conditions.js";
import { howItEnded, type StageCommandRun } from "./stage-command-run.js";
import type { StageRun } from "./stage-run.js";

/**
 * The results of the condition commands recorded on the run the routes leave (spec §2.3, "The
 * Project-command condition"), which the walk replays rather than running a command again. A test
 * reads its own latest run, the install before it included: one The Office stopped, or none, is
 * still to run.
 */
export function recordedCommandResults({ commandRuns }: StageRun): CommandResults {
  return (test) => {
    const latest = commandRuns.findLast((run) => isRunFor(run, test));
    return latest && resultOf(latest, test.key);
  };
}

function isRunFor({ condition }: StageCommandRun, test: CommandTest): boolean {
  return (
    condition !== undefined &&
    condition.key === test.key &&
    condition.routeIndex === test.routeIndex &&
    condition.testPath.length === test.testPath.length &&
    condition.testPath.every((index, at) => index === test.testPath[at])
  );
}

function resultOf(run: StageCommandRun, key: string): Weight | undefined {
  if (run.outcome === "stopped") return undefined;
  if (run.purpose === "install") {
    // A passed install with no command after it: The Office stopped before the command ran.
    if (run.outcome === "passed") return undefined;
    return cannotBeWeighed(
      `The install before the condition's command \`${key}\` ${howItEnded(run)}.`,
    );
  }
  switch (run.outcome) {
    case "passed":
      return { kind: "holds" };
    case "failed":
      return { kind: "does-not-hold" };
    case "could-not-run":
      return cannotBeWeighed(`The condition's command \`${key}\` couldn't run: ${run.output}`);
    case "timed-out":
      return cannotBeWeighed(`The condition's command \`${key}\` ${howItEnded(run)}.`);
  }
}

function cannotBeWeighed(why: string): Weight {
  return { kind: "cannot-be-weighed", why };
}
