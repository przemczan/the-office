/** Why an instance stops (spec §2.12, "When an instance stops"). */
export type StopReason =
  | { readonly kind: "by-user" }
  | { readonly kind: "idle"; readonly minutes: number }
  | { readonly kind: "initiative-ended"; readonly state: "done" | "dropped" }
  | { readonly kind: "restart" };

export const BY_USER: StopReason = { kind: "by-user" };
export const BY_RESTART: StopReason = { kind: "restart" };

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
  }
}

/** Why an instance left Building by a restart failed (spec §2.12, "Test instance states"). */
export const RESTARTED_WHILE_BUILDING = "The Office restarted while it was Building.";

/** The launch's refusals, in the words the Initiative's page shows as they are. */
export const INITIATIVE_NOT_ACTIVE = "Test instances launch only while the Initiative is active.";
export const RUN_ENVIRONMENT_OFF =
  "Turn the Project's Run environment On to launch a Hosted test instance.";

export function noInitiativeBranch(projectId: string): string {
  return `The Initiative has no branch in ${projectId}, so nothing there can be launched.`;
}

export function notLaunchable(name: string): string {
  return `${name} can't be launched; only Hosted and Build to install test targets launch for now.`;
}

export function notRunning(name: string): string {
  return `${name} isn't Running, so it can't be opened. Launch it again from the Initiative's page.`;
}

export function secretsWithoutValue(names: readonly string[]): string {
  return `Type a value for ${names.join(", ")} in the Project's Test targets before launching.`;
}
