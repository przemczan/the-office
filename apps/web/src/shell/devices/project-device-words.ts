import type {
  DisconnectedBecause,
  ProjectDevice,
  ProjectDeviceHolder,
  ProjectDeviceState,
} from "@the-office/contracts";
import type { BadgeProps } from "@the-office/ui";
import { DEVICE_KIND_WORDS } from "./device-words.ts";

// A Project device's words, which a Project's Devices section and a Task's Use a Project device
// both show (spec 2.13, "At rest and in use").

/** Each state's name. */
export const PROJECT_DEVICE_STATE_WORDS: Readonly<Record<ProjectDeviceState, string>> = {
  paired: "Paired",
  "didnt-answer": "Didn't answer",
  "not-paired": "Not paired",
  "over-usb": "Over USB",
  "in-use": "In use",
};

/** Each state's tone: Paired success, Didn't answer and Not paired warning, Over USB neutral, In use info. */
export const PROJECT_DEVICE_STATE_TONES: Readonly<
  Record<ProjectDeviceState, NonNullable<BadgeProps["tone"]>>
> = {
  paired: "success",
  "didnt-answer": "warning",
  "not-paired": "warning",
  "over-usb": "neutral",
  "in-use": "info",
};

/** Whether a device over USB, which the browser relays, rather than a phone over wireless debugging. */
export function isOverUsb(device: Pick<ProjectDevice, "kind">): boolean {
  return device.kind !== "android-wireless";
}

/** What holds a device, as "In use by <name>" names it: a Task's title, an Action run's or a test instance's name. */
export function holderName(holder: ProjectDeviceHolder): string {
  return holder.kind === "task" ? holder.title : holder.name;
}

/** A Project device as a select of them lists it: "Pixel 8 · Android phone over USB · Over USB". */
export function projectDeviceChoiceWords(
  device: Pick<ProjectDevice, "name" | "kind" | "state">,
): string {
  return `${device.name} · ${DEVICE_KIND_WORDS[device.kind]} · ${PROJECT_DEVICE_STATE_WORDS[device.state]}`;
}

/**
 * On a setting naming a device the Project no longer has, by the name it had, or as "Its device"
 * when no name is known.
 */
export function notAProjectDeviceWords(
  deviceName: string | undefined,
  projectName: string,
): string {
  return `${deviceName ?? "Its device"} isn't one of ${projectName}'s devices anymore.`;
}

/** How a use ended, on the last use line. */
export const LAST_USE_ENDED_WORDS: Readonly<Record<DisconnectedBecause, string>> = {
  "by-user": "given back",
  "tab-closed": "tab closed",
  "task-ended": "Task ended",
  "device-unplugged": "device unplugged",
  "run-environment-turned-off": "Run environment turned Off",
  "connected-devices-switched-off": "Connected devices switched off",
  error: "error",
  "run-ended": "run ended",
};
