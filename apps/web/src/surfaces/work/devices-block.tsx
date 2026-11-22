import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ConnectedDevice, Project, ProjectDevice, Task } from "@the-office/contracts";
import { Badge, Button, FoldButton, Icon, Menu, type MenuItem } from "@the-office/ui";
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
  deviceQueries,
  disconnectDevice,
  lendProjectDevice,
} from "../../api/devices.ts";
import { projectQueries } from "../../api/projects.ts";
import { BlockLoaderOrProblem } from "../../shell/block-loader.tsx";
import { DEVICE_STATE_TONES, DEVICE_STATE_WORDS } from "../../shell/device-state-words.ts";
import {
  ADB_SERIAL,
  USB_DEBUGGING_HINT,
} from "../../shell/devices/android-usb/android-usb-words.ts";
import {
  DevicesNote,
  registerBrowserDeviceTransports,
  usbKindChoice,
} from "../../shell/devices/device-parts.tsx";
import {
  deviceNotice,
  keepDeviceRelay,
  subscribeToDeviceNotices,
} from "../../shell/devices/device-relays.ts";
import { DEVICE_KIND_WORDS, KEEP_TAB_OPEN } from "../../shell/devices/device-words.ts";
import {
  isOverUsb,
  PROJECT_DEVICE_STATE_TONES,
  PROJECT_DEVICE_STATE_WORDS,
} from "../../shell/devices/project-device-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { momentWords } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { userName, useSignedInUserId } from "../../shell/use-user-name.ts";
import { ConnectRefused } from "./connect-refused.tsx";
import {
  ADD_ONE_UNDER_DEVICES,
  CONNECT_DEVICE,
  CONNECT_REFUSED,
  connectedToastWords,
  DEVICE_NOTICE_TONES,
  deviceNoticeWords,
  devicesSummary,
  DISCONNECT_REFUSED,
  disconnectedDevicesOf,
  disconnectedToastWords,
  disconnectedWhy,
  givenBackToastWords,
  inUseByWords,
  lentFromWords,
  NO_DEVICES,
  noProjectDevicesWords,
  openDevicesOf,
  PAIR_WIRELESS,
  serialLineWords,
  USE_PROJECT_DEVICE,
} from "./device-words.ts";
import { openProjectDeviceOverUsb } from "./project-device-lend.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";
import { WirelessPairingForm } from "./wireless-pairing-form.tsx";

// Every kind this build reaches in the browser, offered once the Devices section is drawn.
registerBrowserDeviceTransports();

/**
 * The Task's Devices section (spec screens/task-page.md, "Devices"; 2.13): shown only while the
 * Project's Run environment is On and its Connected devices are switched on. A row per device not
 * Disconnected with Disconnect, the earlier ones below as history, and Connect for each kind this
 * build has a transport for, greyed with why for a kind this browser can't reach, and for pairing a
 * phone over wireless debugging; beside it Use a Project device, lending one of the Project's.
 */
export function DevicesBlock({ task }: { readonly task: Task }): ReactNode {
  const project = useQuery(projectQueries.one(task.projectId)).data;
  return project?.runEnvironment === "on" && project.features["connected-devices"] ? (
    <DevicesFold task={task} project={project} />
  ) : null;
}

function DevicesFold({
  task,
  project,
}: {
  readonly task: Task;
  readonly project: Project;
}): ReactNode {
  const query = useQuery(deviceQueries.ofTask(task.id));
  const devices = query.data?.devices;
  const open = openDevicesOf(devices ?? []);
  const fold = useFold({ kind: "task", id: task.id }, "devices", open.length > 0);
  const disconnected = disconnectedDevicesOf(devices ?? []);
  const [historyShown, setHistoryShown] = useState(false);
  const [pairing, setPairing] = useState(false);
  const providers = useSyncExternalStore(
    subscribeToDeviceTransports,
    deviceTransportProviders,
    deviceTransportProviders,
  );
  const connecting = useConnect(task.id);
  const lending = useLend(task.id, providers);
  const disconnecting = useDisconnect(project);
  const nameOf = useUserNames();
  return (
    <>
      <RecordFold
        fold={fold}
        icon="plug"
        title="Devices"
        summary={devicesSummary(devices)}
        side={
          <span className="devices-actions">
            <UseProjectDeviceMenu
              project={project}
              providers={providers}
              busy={lending.isPending}
              onUse={(device) => {
                fold.open();
                connecting.reset();
                lending.mutate(device);
              }}
            />
            <ConnectMenu
              providers={providers}
              busy={connecting.isPending}
              onConnect={(provider) => {
                fold.open();
                lending.reset();
                connecting.mutate(provider);
              }}
              onPairWireless={() => {
                fold.open();
                setPairing(true);
              }}
            />
          </span>
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
                  <DeviceRow key={device.id} device={device} nameOf={nameOf} project={project}>
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
            {(connecting.hinted || lending.hinted) && (
              <DevicesNote icon="lightbulb">{USB_DEBUGGING_HINT}</DevicesNote>
            )}
            <DevicesNote>{KEEP_TAB_OPEN}</DevicesNote>
            {connecting.refused}
            {lending.error && <RefusalAlert title={CONNECT_REFUSED} error={lending.error} />}
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
                      <DeviceRow
                        key={device.id}
                        device={device}
                        nameOf={nameOf}
                        project={project}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </RecordFold>
      {pairing && <WirelessPairingForm taskId={task.id} onClose={() => setPairing(false)} />}
    </>
  );
}

function DeviceRow({
  device,
  nameOf,
  project,
  children,
}: {
  readonly device: ConnectedDevice;
  readonly nameOf: (user: ConnectedDevice["disconnectedBy"]) => string;
  readonly project: Project;
  readonly children?: ReactNode;
}): ReactNode {
  const ended = device.state === "disconnected";
  const line = device.kind === "serial-usb" ? serialLineWords(device) : undefined;
  const asks = useSyncExternalStore(subscribeToDeviceNotices, () => deviceNotice(device.id));
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
          {device.projectDeviceId !== null && (
            <>
              {" · "}
              <Link to="/projects/$projectId/devices" params={{ projectId: project.id }}>
                {lentFromWords(project.name)}
              </Link>
            </>
          )}
        </span>
        {device.state === "connected" &&
          device.endpoint !== null &&
          (device.kind === "android-usb" || device.kind === "android-wireless" ? (
            <span className="devices-row-serial">
              {ADB_SERIAL} <code className="devices-row-endpoint">{device.endpoint}</code>
            </span>
          ) : (
            <span className="devices-row-line">
              <code className="devices-row-endpoint">{device.endpoint}</code>
              {device.rfc2217Url !== null && (
                <>
                  <span className="devices-row-meta" aria-hidden="true">
                    ·
                  </span>
                  <code className="devices-row-endpoint">{device.rfc2217Url}</code>
                </>
              )}
              {line !== undefined && <span className="devices-row-meta">{line}</span>}
            </span>
          ))}
        {!ended && asks !== undefined && (
          <span className="devices-row-notice" data-tone="warning" role="status">
            <Icon name="triangle-alert" size={14} />
            {asks}
          </span>
        )}
        {!ended && device.notices.length > 0 && (
          <ul className="devices-row-notices" aria-label={`What to know about ${device.name}`}>
            {device.notices.map((notice) => (
              <li
                key={notice}
                className="devices-row-notice"
                data-tone={DEVICE_NOTICE_TONES[notice]}
              >
                <Icon
                  name={DEVICE_NOTICE_TONES[notice] === "warning" ? "triangle-alert" : "info"}
                  size={14}
                />
                {deviceNoticeWords(notice, device)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {children !== undefined && <div className="devices-row-side">{children}</div>}
    </li>
  );
}

/**
 * Connect: a menu of the USB kinds a transport is registered for, greyed with why, then Pair over
 * wireless debugging, which every browser offers.
 */
function ConnectMenu({
  providers,
  busy,
  onConnect,
  onPairWireless,
}: {
  readonly providers: readonly DeviceTransportProvider[];
  readonly busy: boolean;
  readonly onConnect: (provider: DeviceTransportProvider) => void;
  readonly onPairWireless: () => void;
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
          {CONNECT_DEVICE}
        </Button>
      }
      items={[
        ...providers.map((provider): MenuItem => {
          return usbKindChoice(provider, () => onConnect(provider));
        }),
        ...(providers.length > 0 ? [{ divider: true }] : []),
        { label: PAIR_WIRELESS, onSelect: onPairWireless },
      ]}
    />
  );
}

/**
 * Connect: the browser's picker, then the record, then the relay this tab keeps; a refusal in its
 * words, naming the other Task as a link when the device is connected there. While an Android
 * phone's picker is open, and after it closed with none picked, the USB debugging hint shows.
 */
function useConnect(taskId: string): {
  readonly isPending: boolean;
  readonly mutate: (provider: DeviceTransportProvider) => void;
  readonly reset: () => void;
  readonly refused: ReactNode;
  readonly hinted: boolean;
} {
  const showToast = useToast();
  const [picked, setPicked] = useState<RequestedDevice>();
  const [hinted, setHinted] = useState(false);
  const connecting = useMutation({
    mutationFn: async (provider: DeviceTransportProvider) => {
      setHinted(provider.kind === "android-usb");
      const device = await provider.request();
      if (device === undefined) return undefined;
      setHinted(false);
      setPicked(device);
      let connected: ConnectedDevice;
      try {
        connected = await connectDevice(taskId, {
          kind: provider.kind,
          name: device.name,
          deviceKey: device.deviceKey,
        });
      } catch (error) {
        device.release?.();
        throw error;
      }
      keepDeviceRelay(connected.id, openDeviceRelay(connected.id, device), device);
      return connected;
    },
    onError: () => setHinted(false),
    onSuccess: (connected) => {
      if (connected !== undefined) showToast(connectedToastWords(connected.name));
    },
  });
  return {
    isPending: connecting.isPending,
    mutate: (provider) => connecting.mutate(provider),
    reset: () => connecting.reset(),
    hinted,
    refused: connecting.error && (
      <ConnectRefused error={connecting.error} deviceName={picked?.name ?? "The device"} />
    ),
  };
}

/** Disconnect: a lent device is given back to the Project's devices, which its toast says. */
function useDisconnect(
  project: Project,
): UseMutationResult<ConnectedDevice, Error, ConnectedDevice> {
  const showToast = useToast();
  return useMutation({
    mutationFn: (device: ConnectedDevice) => disconnectDevice(device.id),
    onSuccess: (device) =>
      showToast(
        device.projectDeviceId === null
          ? disconnectedToastWords(device.name)
          : givenBackToastWords(device.name, project.name),
      ),
  });
}

/**
 * Use a Project device (spec screens/task-page.md, "Devices"): the Project's devices, each with its
 * name, kind and state at rest; one in use elsewhere disabled naming its holder, one over USB
 * greyed where this browser can't reach its kind; with none, a way to the Project's Devices.
 */
function UseProjectDeviceMenu({
  project,
  providers,
  busy,
  onUse,
}: {
  readonly project: Project;
  readonly providers: readonly DeviceTransportProvider[];
  readonly busy: boolean;
  readonly onUse: (device: ProjectDevice) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const devices = useQuery(deviceQueries.ofProject(project.id)).data?.devices;
  const navigate = useNavigate();
  const items: MenuItem[] =
    devices === undefined
      ? [{ disabled: true, label: "Reading the Project's devices…" }]
      : devices.length === 0
        ? [
            { disabled: true, label: noProjectDevicesWords(project.name) },
            {
              label: ADD_ONE_UNDER_DEVICES,
              onSelect: () =>
                void navigate({
                  to: "/projects/$projectId/devices",
                  params: { projectId: project.id },
                }),
            },
          ]
        : devices.map((device) => projectDeviceChoice(device, providers, () => onUse(device)));
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={340}
      trigger={
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          iconLeft={<Icon name="smartphone" size={14} />}
          iconRight={<Icon name="chevron-down" size={14} />}
        >
          {USE_PROJECT_DEVICE}
        </Button>
      }
      items={items}
    />
  );
}

function projectDeviceChoice(
  device: ProjectDevice,
  providers: readonly DeviceTransportProvider[],
  onSelect: () => void,
): MenuItem {
  const head = (
    <span className="devices-choice-head">
      <span className="devices-choice-name">{device.name}</span>
      <Badge size="sm">{DEVICE_KIND_WORDS[device.kind]}</Badge>
      <Badge size="sm" dot tone={PROJECT_DEVICE_STATE_TONES[device.state]}>
        {PROJECT_DEVICE_STATE_WORDS[device.state]}
      </Badge>
    </span>
  );
  if (device.inUseBy !== null) {
    return {
      disabled: true,
      label: (
        <span className="devices-kind">
          {head}
          <span className="devices-kind-why">{inUseByWords(device.inUseBy.title)}</span>
        </span>
      ),
    };
  }
  if (!isOverUsb(device)) return { label: head, onSelect };
  const provider = providers.find(({ kind }) => kind === device.kind);
  if (provider === undefined) return { disabled: true, label: head };
  return usbKindChoice(provider, onSelect, head);
}

/**
 * Lends a Project device to the Task: a phone over wireless debugging connects with the Project's
 * key; one over USB is opened first, without the picker when this browser allowed it before, and
 * its relay then opens from this tab as a connect's does.
 */
function useLend(
  taskId: string,
  providers: readonly DeviceTransportProvider[],
): {
  readonly isPending: boolean;
  readonly mutate: (device: ProjectDevice) => void;
  readonly reset: () => void;
  readonly error: Error | null;
  readonly hinted: boolean;
} {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [hinted, setHinted] = useState(false);
  const lending = useMutation({
    mutationFn: async (device: ProjectDevice) => {
      if (!isOverUsb(device)) return lendProjectDevice(taskId, device.id);
      const provider = providers.find(({ kind }) => kind === device.kind);
      if (provider === undefined) {
        throw new Error(`${DEVICE_KIND_WORDS[device.kind]} can't be reached in this browser.`);
      }
      setHinted(device.kind === "android-usb");
      const opened = await openProjectDeviceOverUsb(provider, device);
      setHinted(false);
      if (opened === undefined) return undefined;
      let lent: ConnectedDevice;
      try {
        lent = await lendProjectDevice(taskId, device.id);
      } catch (error) {
        opened.release?.();
        throw error;
      }
      keepDeviceRelay(lent.id, openDeviceRelay(lent.id, opened), opened);
      return lent;
    },
    onError: () => setHinted(false),
    onSuccess: (lent) => {
      if (lent === undefined) return;
      showToast(connectedToastWords(lent.name));
      void queryClient.invalidateQueries(deviceQueries.ofTask(taskId));
    },
  });
  return {
    isPending: lending.isPending,
    mutate: (device) => lending.mutate(device),
    reset: () => lending.reset(),
    error: lending.error,
    hinted,
  };
}

/** Names a user as the record says, "you" for the signed-in user. */
function useUserNames(): (user: ConnectedDevice["disconnectedBy"]) => string {
  const signedInUserId = useSignedInUserId();
  return (user) => userName(user, signedInUserId, "you");
}
