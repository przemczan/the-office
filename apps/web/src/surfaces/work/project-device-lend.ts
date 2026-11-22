import type { ProjectDevice } from "@the-office/contracts";
import type { DeviceTransportProvider, RequestedDevice } from "../../api/device-relay.ts";
import { serialUsbIdsOfKey } from "../../api/device-transports/serial-usb.ts";

/** A Project device over USB the tab can't find or open (spec 2.13, "A Project device over USB"). */
export function notReachedWords(name: string): string {
  return `${name} isn't plugged into this computer, or the browser can't open it.`;
}

/**
 * Opens a Project device over USB in this tab: without the browser's picker when this browser
 * allowed it before, else through the picker, refusing in words a device picked that isn't it;
 * undefined when the picker closed with none picked.
 */
export async function openProjectDeviceOverUsb(
  provider: DeviceTransportProvider,
  device: Pick<ProjectDevice, "kind" | "deviceKey" | "name">,
): Promise<RequestedDevice | undefined> {
  const remembered = await provider.remembered?.(device.deviceKey);
  if (remembered !== undefined) return remembered;
  const picked = await provider.request();
  if (picked === undefined) return undefined;
  if (!isTheDevice(device, picked.deviceKey)) {
    picked.release?.();
    throw new Error(notReachedWords(device.name));
  }
  return picked;
}

/**
 * Whether the device picked is the Project's: a phone by its whole key (vendor, product and
 * serial number); a serial board by its USB ids, as its key's last part lives only as long as the
 * tab that made it.
 */
export function isTheDevice(
  device: Pick<ProjectDevice, "kind" | "deviceKey">,
  pickedKey: string,
): boolean {
  if (device.kind !== "serial-usb") return pickedKey === device.deviceKey;
  return serialUsbIdsOfKey(pickedKey) === serialUsbIdsOfKey(device.deviceKey);
}
