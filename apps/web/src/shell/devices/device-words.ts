import type { ConnectedDeviceKind } from "@the-office/contracts";

// The words a Task's Devices section and a Project's Devices section both say (spec 2.13,
// screens/task-page.md and screens/project-page.md, "Devices").

/** Each kind's name (spec 2.13, "Connected device"). */
export const DEVICE_KIND_WORDS: Readonly<Record<ConnectedDeviceKind, string>> = {
  "android-usb": "Android phone over USB",
  "serial-usb": "Serial board over USB",
  "android-wireless": "Android phone over wireless debugging",
};

/** Each field of pairing a phone over wireless debugging, its hint. */
export const PAIR_WIRELESS_HINTS = {
  address: "From the phone's Wireless debugging screen, under IP address & Port.",
  port: "The number after the colon on the same screen.",
  pairingPort:
    "From Wireless debugging › Pair device with pairing code: the number after the colon there.",
  pairingCode:
    "From the phone's Wireless debugging › Pair device with pairing code. Used once, never kept.",
} as const;

/** What is wrong with a field before it is sent. */
export const PAIR_WIRELESS_ERRORS = {
  noAddress: "Enter the phone's IP address.",
  badAddress: "Enter an IPv4 or IPv6 address, such as 192.168.1.20.",
  noPort: "Enter the port.",
  badPort: "A port is a number from 1 to 65535.",
  noPairingCode: "Enter the pairing code.",
  badPairingCode: "The pairing code is 6 digits.",
} as const;

/** The note a device over USB carries: closing the tab ends it. */
export const KEEP_TAB_OPEN = "Keep this tab open: closing it disconnects the device.";
