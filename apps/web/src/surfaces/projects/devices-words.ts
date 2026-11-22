import type { ProjectDevice, ProjectDevicePairingStep } from "@the-office/contracts";

// A Project's Devices section's words (spec screens/project-page.md, "Devices" and "Add a device").

export const ADD_A_DEVICE = "Add a device";
export const PHONE_OVER_WIRELESS = "Phone over wireless debugging";
export const ADD_WIRELESS_TITLE = "Add a phone over wireless debugging";
export const DEVICE_NOT_SAVED = "The device wasn't saved";
export const PHONE_NOT_PAIRED = "The phone wasn't paired";
export const NEEDS_RUN_ENVIRONMENT =
  "Needs Run environment On: a device is paired and used in the run environment.";
/** Why Add a device and Pair again are disabled while Run environment isn't On. */
export const NEEDS_RUN_ENVIRONMENT_WHY = "Needs Run environment On";
export const NO_PROJECT_DEVICES =
  "No devices yet. Add a phone or a board, then name it in an Action or an Install on a device test target.";
export const USB_NOTE =
  "A device over USB works in Chrome and Edge only. A run that uses it starts from a browser it is plugged into, which remembers it, and that tab stays open until the run lets go of it.";
export const DIDNT_ANSWER_LINE =
  "Turning wireless debugging off and on changes its Port: change it here, or pair it again.";
export const NOT_USED_YET = "Not used yet";
export const PORT_HINT = "The number after the colon on the phone's Wireless debugging screen.";

/** The card's note: "Phones and boards kept for <Project>, …". */
export function devicesNoteWords(projectName: string): string {
  return `Phones and boards kept for ${projectName}, so an Action or a test target reaches them with nobody connecting them first.`;
}

/** The pairing window's note. */
export function pairingEnvironmentWords(baseBranch: string): string {
  return `Pairing starts a pairing environment from ${baseBranch}'s .devcontainer/ and removes it once done.`;
}

/** Pair again's window: "Pair <name> again". */
export function pairAgainTitle(name: string): string {
  return `Pair ${name} again`;
}

/** A pairing's steps as they pass. */
export const PAIRING_STEP_WORDS: Readonly<Record<ProjectDevicePairingStep, string>> = {
  "starting-environment": "Starting the pairing environment…",
  pairing: "Pairing with the phone…",
  "reading-model": "Reading its model…",
};

/** The steps in the order they pass. */
export const PAIRING_STEPS: readonly ProjectDevicePairingStep[] = [
  "starting-environment",
  "pairing",
  "reading-model",
];

/** Change Port's window title and its note. */
export function changePortTitle(name: string): string {
  return `Change ${name}'s Port`;
}

/** `office@<project>` is the key's name on the phone, by the Project's id. */
export function noPairingNeededWords(project: {
  readonly id: string;
  readonly name: string;
}): string {
  return `No pairing needed: the phone trusts ${project.name}'s key until office@${project.id} is removed from its paired devices.`;
}

/** The trash while the device is in use. */
export function removeHeldWords(holderTitle: string): string {
  return `In use by ${holderTitle}: remove it once it is let go of.`;
}

export function pairedToastWords(model: string, projectName: string): string {
  return `${model} paired with ${projectName}.`;
}

export function addedToastWords(name: string, projectName: string): string {
  return `${name} added to ${projectName}'s devices.`;
}

export function renamedToastWords(name: string): string {
  return `${name} renamed.`;
}

export function portSavedToastWords(name: string): string {
  return `${name}'s Port saved.`;
}

/**
 * Remove's toast; a phone over wireless debugging also keeps trusting the Project's key, which a
 * device over USB never had.
 */
export function removedToastWords(
  device: Pick<ProjectDevice, "name" | "kind">,
  projectName: string,
): string {
  const removed = `${device.name} removed from ${projectName}'s devices.`;
  return device.kind === "android-wireless"
    ? `${removed} The phone keeps trusting ${projectName}'s key until you remove it there.`
    : removed;
}

/** A phone over wireless debugging's place: `<address>:<Port>`. */
export function addressWords(device: Pick<ProjectDevice, "address" | "port">): string | undefined {
  if (device.address === null || device.port === null) return undefined;
  const host = device.address.includes(":") ? `[${device.address}]` : device.address;
  return `${host}:${device.port}`;
}

/** Where a pairing stands: its steps passed so far and the one it is at, or how it ended. */
export type PairingProgress =
  | {
      readonly kind: "pairing";
      readonly passed: readonly ProjectDevicePairingStep[];
      readonly at: ProjectDevicePairingStep;
    }
  | { readonly kind: "paired" }
  | { readonly kind: "failed"; readonly problem: string };

export function pairingProgressOf(
  device: Pick<ProjectDevice, "pairingStep" | "pairingProblem" | "state">,
): PairingProgress {
  if (device.pairingStep !== null) {
    const at = device.pairingStep;
    return { kind: "pairing", passed: PAIRING_STEPS.slice(0, PAIRING_STEPS.indexOf(at)), at };
  }
  if (device.state === "not-paired") {
    return {
      kind: "failed",
      problem: device.pairingProblem ?? "The phone wasn't paired. Pair it again with a new code.",
    };
  }
  return { kind: "paired" };
}
