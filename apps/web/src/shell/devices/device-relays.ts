import type { DeviceRelay, RequestedDevice } from "../../api/device-relay.ts";

// The relays this tab opened, by device id. They live as long as the tab, not the page that
// opened them, so moving within the app keeps each device connected; closing the tab closes them,
// which the service ends as tab closed.
const relays = new Map<string, DeviceRelay>();
// What each device this tab carries asks the user now, such as allowing USB debugging.
const notices = new Map<string, string>();
const noticeListeners = new Set<() => void>();
let closingOnPageHide = false;

/** Keeps a relay this tab opened until it ends, and what its device asks the user meanwhile. */
export function keepDeviceRelay(
  deviceId: string,
  relay: DeviceRelay,
  device?: Pick<RequestedDevice, "onNotice">,
): void {
  relays.get(deviceId)?.close();
  relays.set(deviceId, relay);
  setNotice(deviceId, undefined);
  const stopHearingNotices = device?.onNotice?.((notice) => {
    if (relays.get(deviceId) === relay) setNotice(deviceId, notice);
  });
  relay.onState((state) => {
    if (state.type !== "ended") return;
    stopHearingNotices?.();
    if (relays.get(deviceId) !== relay) return;
    relays.delete(deviceId);
    setNotice(deviceId, undefined);
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

/** What the device asks the user now, while this tab carries it; undefined when nothing. */
export function deviceNotice(deviceId: string): string | undefined {
  return notices.get(deviceId);
}

/** For `useSyncExternalStore`: hears each change of a device's notice. */
export function subscribeToDeviceNotices(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}

/** Closes every relay this tab opened, as the tab closes. */
export function closeEveryDeviceRelay(): void {
  for (const relay of relays.values()) relay.close();
  relays.clear();
  if (notices.size === 0) return;
  notices.clear();
  noticesChanged();
}

function setNotice(deviceId: string, notice: string | undefined): void {
  if (notices.get(deviceId) === notice) return;
  if (notice === undefined) notices.delete(deviceId);
  else notices.set(deviceId, notice);
  noticesChanged();
}

function noticesChanged(): void {
  for (const listener of noticeListeners) listener();
}
