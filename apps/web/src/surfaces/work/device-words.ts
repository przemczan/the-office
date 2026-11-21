import type {
  ConnectedDevice,
  ConnectedDeviceKind,
  ConnectedDeviceState,
} from "@the-office/contracts";
import type { BadgeProps } from "@the-office/ui";

/** Each kind's name (spec 2.13, "Connected device"). */
export const DEVICE_KIND_WORDS: Readonly<Record<ConnectedDeviceKind, string>> = {
  "android-usb": "Android phone over USB",
  "serial-usb": "Serial board over USB",
  "android-wireless": "Android phone over wireless debugging",
};

/** Each state's name (spec 2.13, "States"). */
export const DEVICE_STATE_WORDS: Readonly<Record<ConnectedDeviceState, string>> = {
  connecting: "Connecting",
  connected: "Connected",
  "waiting-for-run-environment": "Waiting for the run environment",
  disconnected: "Disconnected",
};

export const DEVICE_STATE_TONES: Readonly<
  Record<ConnectedDeviceState, NonNullable<BadgeProps["tone"]>>
> = {
  connecting: "info",
  connected: "success",
  "waiting-for-run-environment": "warning",
  disconnected: "neutral",
};

export const KEEP_TAB_OPEN = "Keep this tab open: closing it disconnects the device.";
export const NO_DEVICES = "No device connected. Connect one to reach it from the Task's commands.";
export const CONNECT_REFUSED = "The device wasn't connected";
export const DISCONNECT_REFUSED = "The device wasn't disconnected";

/** The folded line: "<n> connected", or "None connected"; Disconnected ones aren't counted. */
export function devicesSummary(devices: readonly ConnectedDevice[] | undefined): string {
  const open = openDevicesOf(devices ?? []).length;
  return open === 0 ? "None connected" : `${open} connected`;
}

export function openDevicesOf(devices: readonly ConnectedDevice[]): ConnectedDevice[] {
  return devices.filter(({ state }) => state !== "disconnected");
}

export function disconnectedDevicesOf(devices: readonly ConnectedDevice[]): ConnectedDevice[] {
  return devices.filter(({ state }) => state === "disconnected");
}

/** Why a device is Disconnected, as 2.13 names it: "by Ana", "tab closed", "error: …". */
export function disconnectedWhy(
  device: Pick<ConnectedDevice, "disconnectedBecause" | "disconnectedBy" | "problem">,
  nameOf: (user: ConnectedDevice["disconnectedBy"]) => string,
): string {
  switch (device.disconnectedBecause) {
    case "by-user":
      return `by ${nameOf(device.disconnectedBy)}`;
    case "tab-closed":
      return "tab closed";
    case "task-ended":
      return "Task ended";
    case "device-unplugged":
      return "device unplugged";
    case "run-environment-turned-off":
      return "Run environment turned Off";
    case "error":
      return device.problem === null ? "error" : `error: ${device.problem}`;
    case null:
      return "";
  }
}

export function connectedToastWords(name: string): string {
  return `${name} connected.`;
}

export function disconnectedToastWords(name: string): string {
  return `${name} disconnected.`;
}
