// An Android phone over USB's words (spec screens/task-page.md, "Devices").

/** Why the choice is greyed: the browser has no WebUSB. */
export const NEEDS_WEBUSB = "Needs Chrome or Edge";
/** Why the choice is greyed: WebUSB is only for a secure page. */
export const NEEDS_SECURE_CONTEXT = "Needs The Office over HTTPS or localhost";

/** Shown while the browser's picker is open, and after it closed with nothing picked. */
export const USB_DEBUGGING_HINT =
  "Don't see the phone? Turn on USB debugging in Developer options.";

/** On the phone's row while the phone asks the user to let adb in. */
export const ALLOW_USB_DEBUGGING =
  "Allow USB debugging on the phone, and tick Always allow from this computer.";

/** Before the endpoint of a Connected phone: what `adb devices` lists it as. */
export const ADB_SERIAL = "adb serial";

/** The default name of a phone that names neither its maker nor itself. */
export const ANDROID_PHONE = "Android phone";

export const PHONE_IN_USE =
  "The phone is in use by adb on this computer (Android Studio or adb). Run adb kill-server, then connect again.";

export const NO_SERIAL_NUMBER =
  "The phone reports no serial number, so The Office can't tell it from another phone.";

export const NO_USB_DEBUGGING =
  "The phone doesn't offer USB debugging. Turn on USB debugging in Developer options, then connect again.";

/** The system this browser runs on, as far as its user agent tells. */
export type BrowserSystem = "linux" | "windows" | "other";

export function browserSystemOf(userAgent: string): BrowserSystem {
  if (/Windows/.test(userAgent)) return "windows";
  if (/Linux|X11/.test(userAgent) && !/Android|CrOS/.test(userAgent)) return "linux";
  return "other";
}

/** The system didn't let the browser open the phone: what to change, for this browser's system. */
export function accessDeniedWords(vendorId: number, system: BrowserSystem): string {
  const linux = `On Linux, add a udev rule giving you the phone, such as SUBSYSTEM=="usb", ATTR{idVendor}=="${hex4(vendorId)}", MODE="0660", GROUP="plugdev" in /etc/udev/rules.d/51-android.rules, and be in the plugdev group.`;
  const windows =
    "On Windows, install the phone's WinUSB driver (the Google USB Driver, or the phone maker's).";
  const fixes = system === "linux" ? linux : system === "windows" ? windows : `${linux} ${windows}`;
  return `This computer didn't let the browser open the phone. ${fixes} Then unplug the phone and connect again.`;
}

export function hex4(value: number): string {
  return value.toString(16).padStart(4, "0");
}
