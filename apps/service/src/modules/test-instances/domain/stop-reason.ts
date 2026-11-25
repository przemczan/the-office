/** Why an instance stops (spec §2.12, "When an instance stops"). */
export type StopReason =
  | { readonly kind: "by-user" }
  | { readonly kind: "idle"; readonly minutes: number }
  | { readonly kind: "initiative-ended"; readonly state: "done" | "dropped" }
  | { readonly kind: "restart" }
  | { readonly kind: "test-targets-off" };

export const BY_USER: StopReason = { kind: "by-user" };
export const BY_RESTART: StopReason = { kind: "restart" };
/** The Project's Test targets were switched off (spec §2.1.1, "Feature switches"). */
export const BY_TEST_TARGETS_OFF: StopReason = { kind: "test-targets-off" };

/** The log's last line for a stop. */
export function stopWords(reason: StopReason): string {
  switch (reason.kind) {
    case "by-user":
      return "Stopped by you.";
    case "idle":
      return `Stopped after ${reason.minutes} minutes with no request.`;
    case "initiative-ended":
      return `Stopped because the Initiative is ${reason.state === "done" ? "Done" : "Dropped"}.`;
    case "restart":
      return "Stopped because The Office restarted.";
    case "test-targets-off":
      return "Stopped because Test targets were switched off for the Project.";
  }
}

/** Why an instance left Building by a restart failed (spec §2.12, "Test instance states"). */
export const RESTARTED_WHILE_BUILDING = "The Office restarted while it was Building.";
/** Why an Install on a device instance left Installing by a restart failed. */
export const RESTARTED_WHILE_INSTALLING = "The Office restarted while it was Installing.";

/** The launch's refusals, in the words the Initiative's page shows as they are. */
export const INITIATIVE_NOT_ACTIVE = "Test instances launch only while the Initiative is active.";
export const RUN_ENVIRONMENT_OFF =
  "Turn the Project's Run environment On to launch a Hosted test instance.";
/** An Install on a device target needs it On, as a device does (spec §2.12, "Install on a device"). */
export const RUN_ENVIRONMENT_OFF_FOR_INSTALL =
  "Turn the Project's Run environment On to install on a device.";

export function noInitiativeBranch(projectId: string): string {
  return `The Initiative has no branch in ${projectId}, so nothing there can be launched.`;
}

export function notLaunchable(name: string): string {
  return `${name} can't be launched; only Hosted, Build to install and Install on a device test targets launch for now.`;
}

export function notRunning(name: string): string {
  return `${name} isn't Running, so it can't be opened. Launch it again from the Initiative's page.`;
}

/**
 * Why a launch failed when a command its target runs before the entry point is no longer one of
 * the Project's (spec §2.12, "Commands before the entry point").
 */
export function missingCommands(keys: readonly string[]): string {
  return keys.length === 1
    ? `The Project's command ${keys[0]} that runs before the entry point is gone; pick the commands again in the Project's Test targets.`
    : `The Project's commands ${keys.join(", ")} that run before the entry point are gone; pick the commands again in the Project's Test targets.`;
}

export function secretsWithoutValue(names: readonly string[]): string {
  return `Type a value for ${names.join(", ")} in the Project's Test targets before launching.`;
}
