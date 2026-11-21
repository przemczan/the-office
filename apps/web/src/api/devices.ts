import { queryOptions } from "@tanstack/react-query";
import {
  connectDeviceRefusalSchema,
  connectedDeviceListSchema,
  connectedDeviceSchema,
  connectedDeviceWebEventSchema,
  disconnectDevicePath,
  taskDevicesPath,
  type ConnectDevice,
  type ConnectDeviceRefusal,
  type ConnectedDevice,
  type ConnectedDeviceWebEvent,
} from "@the-office/contracts";
import { getFromApi, RefusedAs, sendToApi, sendToApiRefusedAs } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const DEVICES = ["devices"] as const;

export const deviceQueries = {
  /** The Task's Connected devices, the newest first, Disconnected ones kept as its history. */
  ofTask: (taskId: string) =>
    queryOptions({
      queryKey: [...DEVICES, "task", taskId],
      queryFn: ({ signal }) =>
        getFromApi(apiPathOf(taskDevicesPath(taskId)), connectedDeviceListSchema, signal),
    }),
};

/**
 * Connects a device the browser reached to the Task's run environment; it answers the new record,
 * Connecting, whose relay the browser then opens. Refused as `connectRefusalOf` reads.
 */
export function connectDevice(taskId: string, device: ConnectDevice): Promise<ConnectedDevice> {
  return sendToApiRefusedAs(
    "POST",
    apiPathOf(taskDevicesPath(taskId)),
    device,
    connectedDeviceSchema,
    connectDeviceRefusalSchema,
  );
}

/** Disconnects the device, by the signed-in user; it answers the record, Disconnected. */
export function disconnectDevice(deviceId: string): Promise<ConnectedDevice> {
  return sendToApi("POST", apiPathOf(disconnectDevicePath(deviceId)), {}, connectedDeviceSchema);
}

/** Why the service refused a connect, when that is what `error` is. */
export function connectRefusalOf(error: Error | null): ConnectDeviceRefusal | undefined {
  if (!(error instanceof RefusedAs)) return undefined;
  return connectDeviceRefusalSchema.safeParse(error.refusal).data;
}

/**
 * A refusal in words: "<device> is connected to <Task>. Disconnect it there first." when the
 * device is another Task's, the Task given to link; otherwise each reason as the service words it.
 */
export function connectRefusalWords(
  refusal: ConnectDeviceRefusal,
  deviceName: string,
):
  | {
      readonly kind: "other-task";
      readonly before: string;
      readonly after: string;
      readonly task: { readonly id: string; readonly title: string };
    }
  | { readonly kind: "reasons"; readonly reasons: readonly string[] } {
  if (refusal.otherTask !== null) {
    return {
      kind: "other-task",
      before: `${deviceName} is connected to `,
      after: ". Disconnect it there first.",
      task: refusal.otherTask,
    };
  }
  return { kind: "reasons", reasons: refusal.reasons };
}

export const deviceEventInvalidations: Readonly<
  Record<ConnectedDeviceWebEvent["type"], EventInvalidations[string]>
> = {
  "connected-device.changed": (event) => {
    const parsed = connectedDeviceWebEventSchema.safeParse(event);
    return parsed.success ? [deviceQueries.ofTask(parsed.data.taskId).queryKey] : [DEVICES];
  },
};

function apiPathOf(path: string): `/${string}` {
  if (!isApiPath(path)) throw new Error(`${path} is not a path under /api.`);
  return path;
}

function isApiPath(path: string): path is `/${string}` {
  return path.startsWith("/");
}
