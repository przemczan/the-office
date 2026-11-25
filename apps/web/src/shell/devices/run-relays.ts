import {
  connectedDeviceWebEventSchema,
  type ProjectDevice,
  type RelayTab,
} from "@the-office/contracts";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  deviceTransportProviders,
  openDeviceRelay,
  subscribeToDeviceTransports,
  type RequestedDevice,
} from "../../api/device-relay.ts";
import { deviceQueries } from "../../api/devices.ts";
import { useOfficeEvent } from "../../api/event-stream-provider.tsx";
import { registerBrowserDeviceTransports } from "./device-parts.tsx";
import { keepDeviceRelay } from "./device-relays.ts";
import { isOverUsb } from "./project-device-words.ts";
import { openProjectDeviceOverUsb } from "./project-device-over-usb.ts";

// A run's Project device over USB (spec 2.13, "A Project device over USB"): the tab that starts
// the run opens the device as the user starts it, while the browser lets it, and names itself in
// the start as `relayTab`. Once the run's hold is Connecting, this tab opens its relay and keeps
// it, as a lent device's, until the run lets go.

// The devices opened for a run that wait for its hold, by the tab's `relayTab`.
const waiting = new Map<RelayTab, RequestedDevice>();

/** A device opened for a run's start; `release` lets it go when the start was refused. */
export interface RunRelay {
  readonly relayTab: RelayTab;
  release(): void;
}

/** What starting a run that may hold a Project device over USB needs from this tab. */
export interface RunRelayStart {
  /** The run's device when this tab relays it over USB; undefined for none or a wireless phone. */
  readonly device: ProjectDevice | undefined;
  /** Why this browser can't reach that device, so the start is disabled; undefined when it can. */
  readonly unreachable: string | undefined;
  /**
   * Opens the device, without the browser's picker when it allowed it before, and answers its
   * relay to start the run with; null when the run holds no device over USB, undefined when the
   * picker closed with none picked. A device that can't be opened throws in words.
   */
  open(): Promise<RunRelay | null | undefined>;
}

/** "Needs Chrome or Edge to reach <device>.": the start disabled in a browser without WebUSB. */
export function needsBrowserWords(deviceName: string): string {
  return `Needs Chrome or Edge to reach ${deviceName}.`;
}

/** "Keep this tab open until the run lets go of <device>.": under a start that relays a device. */
export function keepTabOpenWords(deviceName: string): string {
  return `Keep this tab open until the run lets go of ${deviceName}.`;
}

/** The Project device a run will hold, by its id, read from the Project's devices. */
export function useRunRelayStart(projectId: string, projectDeviceId: string | null): RunRelayStart {
  registerBrowserDeviceTransports();
  const providers = useSyncExternalStore(
    subscribeToDeviceTransports,
    deviceTransportProviders,
    deviceTransportProviders,
  );
  const devices = useQuery({
    ...deviceQueries.ofProject(projectId),
    enabled: projectDeviceId !== null,
  });
  const held = devices.data?.devices.find(({ id }) => id === projectDeviceId);
  const device = held !== undefined && isOverUsb(held) ? held : undefined;
  const provider = providers.find(({ kind }) => kind === device?.kind);
  const unreachable =
    device !== undefined && (provider === undefined || provider.unavailable !== undefined)
      ? needsBrowserWords(device.name)
      : undefined;
  return {
    device,
    unreachable,
    open: async () => {
      if (device === undefined) return null;
      if (provider === undefined || unreachable !== undefined) throw new Error(unreachable);
      const opened = await openProjectDeviceOverUsb(provider, device);
      return opened === undefined ? undefined : waitForHold(opened);
    },
  };
}

function waitForHold(opened: RequestedDevice): RunRelay {
  const relayTab = crypto.randomUUID();
  waiting.set(relayTab, opened);
  return {
    relayTab,
    release: () => {
      if (waiting.delete(relayTab)) opened.release?.();
    },
  };
}

/**
 * Hears the holds this tab relays, for as long as the shell is shown: one Connecting opens its
 * relay with the device opened at the start; one that ended before it did lets the device go.
 */
export function useRunRelays(): void {
  useOfficeEvent("connected-device.changed", (event) => {
    const parsed = connectedDeviceWebEventSchema.safeParse(event);
    if (!parsed.success || parsed.data.relayTab === null) return;
    const { relayTab, deviceId, state } = parsed.data;
    const opened = waiting.get(relayTab);
    if (opened === undefined) return;
    if (state === "connecting") {
      waiting.delete(relayTab);
      keepDeviceRelay(deviceId, openDeviceRelay(deviceId, opened), opened);
    } else if (state === "disconnected") {
      waiting.delete(relayTab);
      opened.release?.();
    }
  });
}
