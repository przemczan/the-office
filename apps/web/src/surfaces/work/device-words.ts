import type { ConnectedDevice, ConnectedDeviceKind, DeviceNotice } from "@the-office/contracts";

/** Each kind's name (spec 2.13, "Connected device"). */
export const DEVICE_KIND_WORDS: Readonly<Record<ConnectedDeviceKind, string>> = {
  "android-usb": "Android phone over USB",
  "serial-usb": "Serial board over USB",
  "android-wireless": "Android phone over wireless debugging",
};

export const KEEP_TAB_OPEN = "Keep this tab open: closing it disconnects the device.";
export const NO_DEVICES = "No device connected. Connect one to reach it from the Task's commands.";
export const CONNECT_REFUSED = "The device wasn't connected";
export const DISCONNECT_REFUSED = "The device wasn't disconnected";

/** The Connect menu's button: the USB kinds, then pairing over wireless debugging. */
export const CONNECT_DEVICE = "Connect a device";

/** Pairing over wireless debugging (spec screens/task-page.md, "Devices"). */
export const PAIR_WIRELESS = "Pair over wireless debugging";
export const PAIR_WIRELESS_HINTS = {
  address: "From the phone's Wireless debugging screen, under IP address & Port.",
  port: "The number after the colon on the same screen.",
  pairingPort:
    "From Wireless debugging › Pair device with pairing code: the number after the colon there.",
  pairingCode:
    "From the phone's Wireless debugging › Pair device with pairing code. Used once, never kept.",
} as const;
export const PAIRING_STARTS_RUN_ENVIRONMENT = "Pairing starts the Task's run environment.";
export const PAIR_WIRELESS_ERRORS = {
  noAddress: "Enter the phone's IP address.",
  badAddress: "Enter an IPv4 or IPv6 address, such as 192.168.1.20.",
  noPort: "Enter the port.",
  badPort: "A port is a number from 1 to 65535.",
  noPairingCode: "Enter the pairing code.",
  badPairingCode: "The pairing code is 6 digits.",
} as const;

/** The phone a refused pairing names, as no name is known before adb reaches it. */
export function wirelessPhoneWords(address: string): string {
  return `The phone at ${address}`;
}

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

/**
 * Why a device is Disconnected, as 2.13 names it: "by Ana", "tab closed", "error: …", and
 * "device unplugged: …" with the record's problem when it has one.
 */
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
      // A phone over wireless debugging that didn't answer says so: "pair it again".
      return device.problem === null ? "device unplugged" : `device unplugged: ${device.problem}`;
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

export function pairingToastWords(address: string): string {
  return `Pairing with the phone at ${address}…`;
}

export function disconnectedToastWords(name: string): string {
  return `${name} disconnected.`;
}

/** A serial board's line settings and round trip on its row: "115200 baud · round trip 40 ms". */
export function serialLineWords(
  device: Pick<ConnectedDevice, "baudRate" | "roundTripMs">,
): string | undefined {
  const parts = [
    device.baudRate === null ? undefined : `${device.baudRate} baud`,
    device.roundTripMs === null ? undefined : `round trip ${device.roundTripMs} ms`,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** A notice's tone: what slows or stops an upload warns, a missing tool informs. */
export const DEVICE_NOTICE_TONES: Readonly<Record<DeviceNotice, "warning" | "info">> = {
  "slow-round-trip": "warning",
  "no-answer-after-reset": "warning",
  "touch-1200": "warning",
  "esptool-sync-no-answer": "warning",
  "no-upload-tool": "info",
  "port-busy": "warning",
};

/** What the Devices section says for each of a device's notices (spec 2.13, "Serial boards"). */
export function deviceNoticeWords(
  notice: DeviceNotice,
  device: Pick<ConnectedDevice, "roundTripMs" | "endpoint" | "rfc2217Url">,
): string {
  const { roundTripMs, endpoint, rfc2217Url } = device;
  switch (notice) {
    case "slow-round-trip":
      return roundTripMs === null
        ? "Uploads will be slow: each step waits for the round trip."
        : `Uploads will be slow: each step waits ${roundTripMs} ms for the round trip.`;
    case "no-answer-after-reset":
      return roundTripMs === null
        ? "The board didn't answer after its reset; its bootloader may not wait for the round trip. Press its reset button as the upload starts."
        : `The board didn't answer after its reset; its bootloader may not wait for the ${roundTripMs} ms round trip. Press its reset button as the upload starts.`;
    case "touch-1200":
      return "This board resets into a new USB device to upload (1200-baud touch, as Leonardo and Micro do); that isn't carried through the browser.";
    case "esptool-sync-no-answer":
      return rfc2217Url === null
        ? "esptool's automatic reset isn't carried on this port. Hold BOOT, tap reset, and upload with --before no_reset."
        : `Use --port ${rfc2217Url} for esptool's automatic reset, or hold BOOT, tap reset and upload with --before no_reset.`;
    case "port-busy":
      return `The board is busy: one tool at a time can have it open${portsWords(endpoint, rfc2217Url)}. Close the other one first.`;
    case "no-upload-tool":
      return "Neither avrdude nor arduino-cli is in the run environment's image; add the Project's upload tool to .devcontainer.";
  }
}

// Where a serial board can be opened: ", at /dev/ttyACM0 or at rfc2217://…", either alone, or "".
function portsWords(endpoint: string | null, rfc2217Url: string | null): string {
  const at = [endpoint, rfc2217Url].filter((where) => where !== null).map((where) => `at ${where}`);
  return at.length === 0 ? "" : `, ${at.join(" or ")}`;
}
