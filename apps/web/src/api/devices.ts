import {
  queryOptions,
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  connectDeviceRefusalSchema,
  connectedDeviceListSchema,
  connectedDeviceSchema,
  connectedDeviceWebEventSchema,
  disconnectDevicePath,
  projectDeviceListSchema,
  projectDevicePairPath,
  projectDevicePath,
  projectDeviceSchema,
  projectDevicesPath,
  projectDeviceWebEventSchema,
  taskDevicesPath,
  taskLendDevicePath,
  taskWirelessDevicesPath,
  type AddProjectDevice,
  type ChangeProjectDevice,
  type ConnectDevice,
  type ConnectDeviceRefusal,
  type ConnectedDevice,
  type ConnectedDeviceWebEvent,
  type PairProjectDevice,
  type PairWirelessDevice,
  type ProjectDevice,
  type ProjectDeviceWebEvent,
} from "@the-office/contracts";
import {
  deleteFromApi,
  getFromApi,
  RefusedAs,
  sendToApi,
  sendToApiRefusedAs,
} from "./api-client.ts";
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
  /**
   * The Project's devices in the order added (spec 2.13, "A Project's device"), under the devices'
   * key, apart from the Projects', so only `project-device.changed` reads them again.
   */
  ofProject: (projectId: string) =>
    queryOptions({
      queryKey: [...DEVICES, "project", projectId],
      queryFn: ({ signal }) =>
        getFromApi(apiPathOf(projectDevicesPath(projectId)), projectDeviceListSchema, signal),
    }),
};

/**
 * Adds a device to the Project: one over USB by the device key the browser reached, or a phone
 * over wireless debugging, added Not paired and paired in the background, its `pairingStep`
 * followed through `project-device.changed`. Refused in the service's words (`ApiError.reasons`).
 */
export function addProjectDevice(
  projectId: string,
  device: AddProjectDevice,
): Promise<ProjectDevice> {
  return sendToApi("POST", apiPathOf(projectDevicesPath(projectId)), device, projectDeviceSchema);
}

/** Renames a Project device, or gives a phone over wireless debugging its new Port. */
export function changeProjectDevice(
  projectDeviceId: string,
  change: ChangeProjectDevice,
): Promise<ProjectDevice> {
  return sendToApi(
    "PATCH",
    apiPathOf(projectDevicePath(projectDeviceId)),
    change,
    projectDeviceSchema,
  );
}

/** Pairs a phone over wireless debugging again; it answers the device, its pairing started. */
export function pairProjectDevice(
  projectDeviceId: string,
  pairing: PairProjectDevice,
): Promise<ProjectDevice> {
  return sendToApi(
    "POST",
    apiPathOf(projectDevicePairPath(projectDeviceId)),
    pairing,
    projectDeviceSchema,
  );
}

/** Forgets a Project device; refused while it is in use, naming the holder. */
export function removeProjectDevice(projectDeviceId: string): Promise<void> {
  return deleteFromApi(apiPathOf(projectDevicePath(projectDeviceId)));
}

/**
 * Use a Project device: lends it to the Task's run environment with no pairing; it answers the new
 * Connected device record, Connecting, whose relay the browser opens for a device over USB.
 */
export function lendProjectDevice(
  taskId: string,
  projectDeviceId: string,
): Promise<ConnectedDevice> {
  return sendToApi(
    "POST",
    apiPathOf(taskLendDevicePath(taskId)),
    { projectDeviceId },
    connectedDeviceSchema,
  );
}

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

/**
 * Pairs an Android phone over wireless debugging with the Task's run environment, starting it when
 * it isn't running; it answers the new record, Connecting. Refused as `connectRefusalOf` reads.
 */
export function pairWirelessDevice(
  taskId: string,
  pairing: PairWirelessDevice,
): Promise<ConnectedDevice> {
  return sendToApiRefusedAs(
    "POST",
    apiPathOf(taskWirelessDevicesPath(taskId)),
    pairing,
    connectedDeviceSchema,
    connectDeviceRefusalSchema,
  );
}

/** Pairing over wireless debugging, the Task's devices read again once the record is made. */
export function usePairWirelessDevice(
  taskId: string,
): UseMutationResult<ConnectedDevice, Error, PairWirelessDevice> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pairing: PairWirelessDevice) => pairWirelessDevice(taskId, pairing),
    onSuccess: () => queryClient.invalidateQueries(deviceQueries.ofTask(taskId)),
  });
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

export const projectDeviceEventInvalidations: Readonly<
  Record<ProjectDeviceWebEvent["type"], EventInvalidations[string]>
> = {
  "project-device.changed": (event) => {
    const parsed = projectDeviceWebEventSchema.safeParse(event);
    return parsed.success ? [deviceQueries.ofProject(parsed.data.projectId).queryKey] : [DEVICES];
  },
};

function apiPathOf(path: string): `/${string}` {
  if (!isApiPath(path)) throw new Error(`${path} is not a path under /api.`);
  return path;
}

function isApiPath(path: string): path is `/${string}` {
  return path.startsWith("/");
}
