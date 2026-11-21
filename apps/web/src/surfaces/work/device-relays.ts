import type { DeviceRelay } from "../../api/device-relay.ts";

// The relays this tab opened, by device id. They live as long as the tab, not the page that
// opened them, so moving within the app keeps each device connected; closing the tab closes them,
// which the service ends as tab closed.
const relays = new Map<string, DeviceRelay>();
let closingOnPageHide = false;

/** Keeps a relay this tab opened until it ends. */
export function keepDeviceRelay(deviceId: string, relay: DeviceRelay): void {
  relays.get(deviceId)?.close();
  relays.set(deviceId, relay);
  relay.onState((state) => {
    if (state.type === "ended" && relays.get(deviceId) === relay) relays.delete(deviceId);
  });
  if (!closingOnPageHide && typeof window !== "undefined") {
    closingOnPageHide = true;
    window.addEventListener("pagehide", closeEveryDeviceRelay);
  }
}

/** Whether this tab carries the device's relay. */
export function keepsDeviceRelay(deviceId: string): boolean {
  return relays.has(deviceId);
}

/** Closes every relay this tab opened, as the tab closes. */
export function closeEveryDeviceRelay(): void {
  for (const relay of relays.values()) relay.close();
  relays.clear();
}
