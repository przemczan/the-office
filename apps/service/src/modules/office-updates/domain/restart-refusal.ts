import type { OfficeContainerRead } from "./office-container.js";
import type { ScheduledExitKind } from "./scheduled-exit.js";

/**
 * What decides whether something would start The Office again once it exits: its launcher, which
 * starts the service again after it exits for a restart, or Docker's restart policy for a container.
 */
export type RestartState =
  | { readonly install: "checkout"; readonly launched: boolean }
  | {
      readonly install: "release";
      readonly launched: boolean;
      /** Whether its launcher runs it from its releases folder; a copy elsewhere stops with it. */
      readonly installed: boolean;
    }
  | { readonly install: "container"; readonly container: OfficeContainerRead };

const RESTART_IT_WHERE_IT_RUNS = "Restart it where it runs.";

export const NO_LAUNCHER_TO_RESTART = `Nothing here would start The Office again: it runs without its launcher. ${RESTART_IT_WHERE_IT_RUNS}`;
export const NOT_INSTALLED_TO_RESTART = `Nothing here would start The Office again: this copy wasn't installed into a releases folder, so its launcher stops with it. ${RESTART_IT_WHERE_IT_RUNS}`;
export const UPDATE_SCHEDULED_ALREADY =
  "An update is scheduled already; it starts The Office again too.";
export const RESTART_SCHEDULED_ALREADY = "A restart is scheduled already.";

/** Docker's restart policies that start a container again after its process exits with code 75. */
const POLICIES_THAT_RESTART: readonly string[] = ["always", "unless-stopped", "on-failure"];

export function dockerUnreachable(problem: string): string {
  return `Nothing here would start The Office again: The Office can't reach Docker to read its container's restart policy (${problem}). ${RESTART_IT_WHERE_IT_RUNS}`;
}

export function noRestartPolicy(policy: string): string {
  return `Nothing here would start The Office again: its container's restart policy is ${policy}. ${RESTART_IT_WHERE_IT_RUNS} Or give it a restart policy such as unless-stopped, as the Docker Compose install does.`;
}

/**
 * Why a restart of a container would leave it stopped, or undefined when Docker would start it
 * again: also read at hand-off, as the policy may have changed while the restart waited.
 */
export function containerRestartRefusal(read: OfficeContainerRead): string | undefined {
  if (!read.reachable) return dockerUnreachable(read.problem);
  const { restartPolicy } = read.container;
  return POLICIES_THAT_RESTART.includes(restartPolicy) ? undefined : noRestartPolicy(restartPolicy);
}

/** Why Restart is refused while an update or a restart is scheduled already. */
export function alreadyScheduled(scheduled: ScheduledExitKind | undefined): string | undefined {
  if (scheduled === "update") return UPDATE_SCHEDULED_ALREADY;
  if (scheduled === "restart") return RESTART_SCHEDULED_ALREADY;
  return undefined;
}

/**
 * Why Restart is refused, or undefined when it can be scheduled: only where something would start
 * The Office again, and only one update or restart scheduled at a time.
 */
export function restartRefusal(
  state: RestartState,
  scheduled: ScheduledExitKind | undefined,
): string | undefined {
  const already = alreadyScheduled(scheduled);
  if (already) return already;
  switch (state.install) {
    case "checkout":
      return state.launched ? undefined : NO_LAUNCHER_TO_RESTART;
    case "release":
      if (!state.launched) return NO_LAUNCHER_TO_RESTART;
      return state.installed ? undefined : NOT_INSTALLED_TO_RESTART;
    case "container":
      return containerRestartRefusal(state.container);
  }
}
