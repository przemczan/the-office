import { useMutation, useQuery, type UseMutationResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ConnectedDevice, Task } from "@the-office/contracts";
import { Alert, Badge, Button, FoldButton, Icon, Menu } from "@the-office/ui";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  deviceTransportProviders,
  openDeviceRelay,
  subscribeToDeviceTransports,
  type DeviceTransportProvider,
  type RequestedDevice,
} from "../../api/device-relay.ts";
import {
  connectDevice,
  connectRefusalOf,
  connectRefusalWords,
  deviceQueries,
  disconnectDevice,
} from "../../api/devices.ts";
import { projectQueries } from "../../api/projects.ts";
import { BlockLoaderOrProblem } from "../../shell/block-loader.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { momentWords } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { userName, useSignedInUserId } from "../../shell/use-user-name.ts";
import { keepDeviceRelay } from "./device-relays.ts";
import {
  CONNECT_REFUSED,
  connectedToastWords,
  DEVICE_KIND_WORDS,
  DEVICE_STATE_TONES,
  DEVICE_STATE_WORDS,
  devicesSummary,
  DISCONNECT_REFUSED,
  disconnectedDevicesOf,
  disconnectedToastWords,
  disconnectedWhy,
  KEEP_TAB_OPEN,
  NO_DEVICE_TRANSPORT,
  NO_DEVICES,
  openDevicesOf,
} from "./device-words.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";

/**
 * The Task's Devices section (spec screens/task-page.md, "Devices"; 2.13): shown only while the
 * Project's Run environment is On. A row per device not Disconnected with Disconnect, the earlier
 * ones below as history, and Connect for each kind this browser has a transport for.
 */
export function DevicesBlock({ task }: { readonly task: Task }): ReactNode {
  const project = useQuery(projectQueries.one(task.projectId)).data;
  return project?.runEnvironment === "on" ? <DevicesFold task={task} /> : null;
}

function DevicesFold({ task }: { readonly task: Task }): ReactNode {
  const query = useQuery(deviceQueries.ofTask(task.id));
  const devices = query.data?.devices;
  const open = openDevicesOf(devices ?? []);
  const fold = useFold({ kind: "task", id: task.id }, "devices", open.length > 0);
  const disconnected = disconnectedDevicesOf(devices ?? []);
  const [historyShown, setHistoryShown] = useState(false);
  const providers = useSyncExternalStore(
    subscribeToDeviceTransports,
    deviceTransportProviders,
    deviceTransportProviders,
  );
  const connecting = useConnect(task.id);
  const disconnecting = useDisconnect();
  const nameOf = useUserNames();
  return (
    <RecordFold
      fold={fold}
      icon="plug"
      title="Devices"
      summary={devicesSummary(devices)}
      side={
        providers.length > 0 ? (
          <ConnectMenu
            providers={providers}
            busy={connecting.isPending}
            onConnect={(provider) => {
              fold.open();
              connecting.mutate(provider);
            }}
          />
        ) : undefined
      }
    >
      {devices === undefined ? (
        <BlockLoaderOrProblem shape="rows" count={1} reads={[query]} />
      ) : (
        <div className="devices">
          {open.length === 0 ? (
            <p className="task-quiet">{NO_DEVICES}</p>
          ) : (
            <ul className="devices-list" aria-label="Devices connected">
              {open.map((device) => (
                <DeviceRow key={device.id} device={device} nameOf={nameOf}>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={disconnecting.isPending && disconnecting.variables?.id === device.id}
                    onClick={() => disconnecting.mutate(device)}
                  >
                    Disconnect
                  </Button>
                </DeviceRow>
              ))}
            </ul>
          )}
          <p className="devices-note">
            <Icon name="info" size={14} />
            {providers.length === 0 ? NO_DEVICE_TRANSPORT : KEEP_TAB_OPEN}
          </p>
          {connecting.refused}
          {disconnecting.error && (
            <RefusalAlert title={DISCONNECT_REFUSED} error={disconnecting.error} />
          )}
          {disconnected.length > 0 && (
            <div className="devices-history">
              <FoldButton
                className="devices-history-head"
                unfolded={historyShown}
                onClick={() => setHistoryShown(!historyShown)}
              >
                Disconnected · {disconnected.length}
              </FoldButton>
              {historyShown && (
                <ul className="devices-list" aria-label="Disconnected devices">
                  {disconnected.map((device) => (
                    <DeviceRow key={device.id} device={device} nameOf={nameOf} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </RecordFold>
  );
}

function DeviceRow({
  device,
  nameOf,
  children,
}: {
  readonly device: ConnectedDevice;
  readonly nameOf: (user: ConnectedDevice["disconnectedBy"]) => string;
  readonly children?: ReactNode;
}): ReactNode {
  const ended = device.state === "disconnected";
  return (
    <li className="devices-row" aria-label={device.name}>
      <div className="devices-row-main">
        <div className="devices-row-head">
          <span className="devices-row-name">{device.name}</span>
          <Badge size="sm">{DEVICE_KIND_WORDS[device.kind]}</Badge>
          <Badge size="sm" dot tone={DEVICE_STATE_TONES[device.state]}>
            {DEVICE_STATE_WORDS[device.state]}
          </Badge>
          {ended && <span className="devices-row-why">{disconnectedWhy(device, nameOf)}</span>}
        </div>
        <span className="devices-row-meta">
          connected by {nameOf(device.connectedBy)} · {momentWords(device.connectedAt)}
          {ended && device.disconnectedAt !== null && (
            <> · disconnected {momentWords(device.disconnectedAt)}</>
          )}
        </span>
        {device.state === "connected" && device.endpoint !== null && (
          <code className="devices-row-endpoint">{device.endpoint}</code>
        )}
      </div>
      {children !== undefined && <div className="devices-row-side">{children}</div>}
    </li>
  );
}

/** Connect over USB: a menu of the kinds a transport is registered for. */
function ConnectMenu({
  providers,
  busy,
  onConnect,
}: {
  readonly providers: readonly DeviceTransportProvider[];
  readonly busy: boolean;
  readonly onConnect: (provider: DeviceTransportProvider) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={300}
      trigger={
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          iconLeft={<Icon name="plug" size={14} />}
          iconRight={<Icon name="chevron-down" size={14} />}
        >
          Connect over USB
        </Button>
      }
      items={providers.map((provider) => ({
        label: DEVICE_KIND_WORDS[provider.kind],
        onSelect: () => onConnect(provider),
      }))}
    />
  );
}

/**
 * Connect: the browser's picker, then the record, then the relay this tab keeps; a refusal in its
 * words, naming the other Task as a link when the device is connected there.
 */
function useConnect(taskId: string): {
  readonly isPending: boolean;
  readonly mutate: (provider: DeviceTransportProvider) => void;
  readonly refused: ReactNode;
} {
  const showToast = useToast();
  const [picked, setPicked] = useState<RequestedDevice>();
  const connecting = useMutation({
    mutationFn: async (provider: DeviceTransportProvider) => {
      const device = await provider.request();
      if (device === undefined) return undefined;
      setPicked(device);
      const connected = await connectDevice(taskId, {
        kind: provider.kind,
        name: device.name,
        deviceKey: device.deviceKey,
      });
      keepDeviceRelay(connected.id, openDeviceRelay(connected.id, device));
      return connected;
    },
    onSuccess: (connected) => {
      if (connected !== undefined) showToast(connectedToastWords(connected.name));
    },
  });
  return {
    isPending: connecting.isPending,
    mutate: (provider) => connecting.mutate(provider),
    refused: connecting.error && (
      <ConnectRefused error={connecting.error} deviceName={picked?.name ?? "The device"} />
    ),
  };
}

function ConnectRefused({
  error,
  deviceName,
}: {
  readonly error: Error;
  readonly deviceName: string;
}): ReactNode {
  const refusal = connectRefusalOf(error);
  if (refusal === undefined) return <RefusalAlert title={CONNECT_REFUSED} error={error} />;
  const words = connectRefusalWords(refusal, deviceName);
  return (
    <Alert tone="danger" title={CONNECT_REFUSED}>
      {words.kind === "other-task" ? (
        <p className="devices-refusal">
          {words.before}
          <Link to="/tasks/$taskId" params={{ taskId: words.task.id }}>
            {words.task.title}
          </Link>
          {words.after}
        </p>
      ) : (
        <ul className="refusal-reasons">
          {words.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

function useDisconnect(): UseMutationResult<ConnectedDevice, Error, ConnectedDevice> {
  const showToast = useToast();
  return useMutation({
    mutationFn: (device: ConnectedDevice) => disconnectDevice(device.id),
    onSuccess: (device) => showToast(disconnectedToastWords(device.name)),
  });
}

/** Names a user as the record says, "you" for the signed-in user. */
function useUserNames(): (user: ConnectedDevice["disconnectedBy"]) => string {
  const signedInUserId = useSignedInUserId();
  return (user) => userName(user, signedInUserId, "you");
}
