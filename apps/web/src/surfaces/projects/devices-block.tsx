import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  PROJECT_DEVICE_NAME_MAX_LENGTH,
  type Project,
  type ProjectDevice,
} from "@the-office/contracts";
import { Alert, Badge, Button, Icon, IconButton, Input, Menu, type MenuItem } from "@the-office/ui";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  deviceTransportProviders,
  subscribeToDeviceTransports,
  type DeviceTransportProvider,
} from "../../api/device-relay.ts";
import {
  addProjectDevice,
  changeProjectDevice,
  deviceQueries,
  removeProjectDevice,
} from "../../api/devices.ts";
import { BlockLoaderOrProblem } from "../../shell/block-loader.tsx";
import {
  DevicesNote,
  registerBrowserDeviceTransports,
  usbKindChoice,
} from "../../shell/devices/device-parts.tsx";
import { DEVICE_KIND_WORDS } from "../../shell/devices/device-words.ts";
import {
  isOverUsb,
  LAST_USE_ENDED_WORDS,
  PROJECT_DEVICE_STATE_TONES,
  PROJECT_DEVICE_STATE_WORDS,
} from "../../shell/devices/project-device-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { momentWords } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { ChangePortWindow } from "./change-port-window.tsx";
import { DevicePairingWindow } from "./device-pairing-window.tsx";
import {
  ADD_A_DEVICE,
  addedToastWords,
  addressWords,
  DEVICE_NOT_SAVED,
  devicesNoteWords,
  DIDNT_ANSWER_LINE,
  NEEDS_RUN_ENVIRONMENT,
  NEEDS_RUN_ENVIRONMENT_WHY,
  NO_PROJECT_DEVICES,
  NOT_USED_YET,
  PHONE_OVER_WIRELESS,
  removedToastWords,
  removeHeldWords,
  renamedToastWords,
  USB_NOTE,
} from "./devices-words.ts";
import { ProjectBlock } from "./project-block.tsx";

// The kinds this build reaches in the browser, for adding a device over USB.
registerBrowserDeviceTransports();

/** Which window is open over the section. */
type Opened =
  | { readonly kind: "add-wireless" }
  | { readonly kind: "pair-again"; readonly device: ProjectDevice }
  | { readonly kind: "change-port"; readonly device: ProjectDevice };

/**
 * A Project's Devices section (spec screens/project-page.md, "Devices"; 2.13, "A Project's
 * device"): its devices, kept between uses, each with its state at rest or its holder, its last use,
 * Rename, a phone's Change Port and Pair again, and Remove; Add a device over USB through the
 * browser's picker or a phone over wireless debugging through the pairing window. While Run
 * environment isn't On they stay listed, Add a device and Pair again disabled. It follows
 * `project-device.changed`.
 */
export function DevicesBlock({ project }: { readonly project: Project }): ReactNode {
  const query = useQuery(deviceQueries.ofProject(project.id));
  const devices = query.data?.devices;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [opened, setOpened] = useState<Opened>();
  const [renaming, setRenaming] = useState<string>();
  const providers = useSyncExternalStore(
    subscribeToDeviceTransports,
    deviceTransportProviders,
    deviceTransportProviders,
  );
  const runEnvironmentOn = project.runEnvironment === "on";
  const readAgain = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: deviceQueries.ofProject(project.id).queryKey });

  const adding = useMutation({
    mutationFn: async (provider: DeviceTransportProvider) => {
      const picked = await provider.request();
      if (picked === undefined) return undefined;
      try {
        return await addProjectDevice(project.id, {
          kind: provider.kind,
          name: picked.name,
          deviceKey: picked.deviceKey,
        });
      } finally {
        // Nothing is connected at rest: the browser lets go of it at once.
        picked.release?.();
      }
    },
    onSuccess: (added) => {
      if (added === undefined) return;
      showToast(addedToastWords(added.name, project.name));
      void readAgain();
    },
  });
  const renamingDevice = useMutation({
    mutationFn: ({ device, name }: { readonly device: ProjectDevice; readonly name: string }) =>
      changeProjectDevice(device.id, { name }),
    onSuccess: (saved) => {
      setRenaming(undefined);
      showToast(renamedToastWords(saved.name));
      void readAgain();
    },
  });
  const removing = useMutation({
    mutationFn: async (device: ProjectDevice) => {
      await removeProjectDevice(device.id);
      return device;
    },
    onSuccess: (device) => {
      showToast(removedToastWords(device, project.name));
      void readAgain();
    },
  });
  // One action's refusal shows until the next action, so another's never shows as its own.
  const resetAll = (): void => {
    adding.reset();
    renamingDevice.reset();
    removing.reset();
  };
  const failure = adding.error ?? renamingDevice.error ?? removing.error;

  return (
    <>
      <ProjectBlock
        icon="smartphone"
        title="Devices"
        actions={
          <AddDeviceMenu
            providers={providers}
            disabled={!runEnvironmentOn}
            busy={adding.isPending}
            onAddOverUsb={(provider) => {
              resetAll();
              adding.mutate(provider);
            }}
            onAddWireless={() => setOpened({ kind: "add-wireless" })}
          />
        }
      >
        <p className="project-block-text">{devicesNoteWords(project.name)}</p>
        {!runEnvironmentOn && (
          <div className="project-devices-warning">
            <Alert tone="warning">
              {NEEDS_RUN_ENVIRONMENT}{" "}
              <Link to="/projects/$projectId/run-environment" params={{ projectId: project.id }}>
                Run environment
              </Link>
            </Alert>
          </div>
        )}
        <div className="devices project-devices">
          {devices === undefined ? (
            <BlockLoaderOrProblem shape="rows" count={1} reads={[query]} />
          ) : devices.length === 0 ? (
            <p className="project-block-text">{NO_PROJECT_DEVICES}</p>
          ) : (
            <ul className="devices-list" aria-label={`${project.name}'s devices`}>
              {devices.map((device) => (
                <ProjectDeviceRow
                  key={device.id}
                  device={device}
                  renaming={renaming === device.id}
                  savingName={
                    renamingDevice.isPending && renamingDevice.variables?.device.id === device.id
                  }
                  removing={removing.isPending && removing.variables?.id === device.id}
                  pairAgainWhy={runEnvironmentOn ? undefined : NEEDS_RUN_ENVIRONMENT_WHY}
                  onRename={() => {
                    resetAll();
                    setRenaming(device.id);
                  }}
                  onSaveName={(name) => {
                    resetAll();
                    renamingDevice.mutate({ device, name });
                  }}
                  onCancelRename={() => setRenaming(undefined)}
                  onChangePort={() => setOpened({ kind: "change-port", device })}
                  onPairAgain={() => setOpened({ kind: "pair-again", device })}
                  onRemove={() => {
                    resetAll();
                    removing.mutate(device);
                  }}
                />
              ))}
            </ul>
          )}
          <DevicesNote>{USB_NOTE}</DevicesNote>
          {failure && <RefusalAlert title={DEVICE_NOT_SAVED} error={failure} />}
        </div>
      </ProjectBlock>
      {opened?.kind === "add-wireless" && (
        <DevicePairingWindow project={project} onClose={() => setOpened(undefined)} />
      )}
      {opened?.kind === "pair-again" && (
        <DevicePairingWindow
          project={project}
          device={opened.device}
          onClose={() => setOpened(undefined)}
        />
      )}
      {opened?.kind === "change-port" && (
        <ChangePortWindow
          project={project}
          device={opened.device}
          onClose={() => setOpened(undefined)}
        />
      )}
    </>
  );
}

/**
 * Add a device: the USB kinds this build reaches, greyed with why where this browser can't, then
 * a divider and Phone over wireless debugging; disabled, saying so, while Run environment isn't On.
 */
function AddDeviceMenu({
  providers,
  disabled,
  busy,
  onAddOverUsb,
  onAddWireless,
}: {
  readonly providers: readonly DeviceTransportProvider[];
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onAddOverUsb: (provider: DeviceTransportProvider) => void;
  readonly onAddWireless: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const trigger = (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      disabled={disabled}
      title={disabled ? NEEDS_RUN_ENVIRONMENT_WHY : undefined}
      iconLeft={<Icon name="plus" size={14} />}
      iconRight={<Icon name="chevron-down" size={14} />}
    >
      {ADD_A_DEVICE}
    </Button>
  );
  if (disabled) return trigger;
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={300}
      trigger={trigger}
      items={[
        ...providers.map((provider): MenuItem =>
          usbKindChoice(provider, () => onAddOverUsb(provider)),
        ),
        ...(providers.length > 0 ? [{ divider: true }] : []),
        { label: PHONE_OVER_WIRELESS, onSelect: onAddWireless },
      ]}
    />
  );
}

function ProjectDeviceRow({
  device,
  renaming,
  savingName,
  removing,
  pairAgainWhy,
  onRename,
  onSaveName,
  onCancelRename,
  onChangePort,
  onPairAgain,
  onRemove,
}: {
  readonly device: ProjectDevice;
  readonly renaming: boolean;
  readonly savingName: boolean;
  readonly removing: boolean;
  /** Why Pair again is disabled, while it is. */
  readonly pairAgainWhy: string | undefined;
  readonly onRename: () => void;
  readonly onSaveName: (name: string) => void;
  readonly onCancelRename: () => void;
  readonly onChangePort: () => void;
  readonly onPairAgain: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  const place = addressWords(device);
  const holder = device.inUseBy;
  return (
    <li className="devices-row" aria-label={device.name}>
      <div className="devices-row-main">
        {renaming ? (
          <RenameField
            device={device}
            saving={savingName}
            onSave={onSaveName}
            onCancel={onCancelRename}
          />
        ) : (
          <div className="devices-row-head">
            <span className="devices-row-name">{device.name}</span>
            <Badge size="sm">{DEVICE_KIND_WORDS[device.kind]}</Badge>
            <Badge size="sm" dot tone={PROJECT_DEVICE_STATE_TONES[device.state]}>
              {PROJECT_DEVICE_STATE_WORDS[device.state]}
            </Badge>
            {holder !== null && (
              <span className="devices-row-meta">
                by{" "}
                <Link to="/tasks/$taskId" params={{ taskId: holder.taskId }}>
                  {holder.title}
                </Link>
              </span>
            )}
          </div>
        )}
        {device.kind === "android-wireless" && place !== undefined && (
          <code className="devices-row-endpoint">{place}</code>
        )}
        <span className="devices-row-meta">
          {device.lastUse === null ? (
            NOT_USED_YET
          ) : (
            <>
              Last used by{" "}
              <Link to="/tasks/$taskId" params={{ taskId: device.lastUse.holder.taskId }}>
                {device.lastUse.holder.title}
              </Link>
              {` · ${momentWords(device.lastUse.endedAt)} · ${LAST_USE_ENDED_WORDS[device.lastUse.endedBecause]}`}
            </>
          )}
        </span>
        {device.state === "didnt-answer" && (
          <span className="devices-row-notice" data-tone="warning">
            <Icon name="triangle-alert" size={14} />
            {DIDNT_ANSWER_LINE}
          </span>
        )}
      </div>
      {!renaming && (
        <div className="devices-row-side project-devices-tools">
          <IconButton
            icon={<Icon name="pencil" size={14} />}
            label={`Rename ${device.name}`}
            size="sm"
            onClick={onRename}
          />
          {!isOverUsb(device) && (
            <>
              <Button size="sm" variant="secondary" onClick={onChangePort}>
                Change Port
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pairAgainWhy !== undefined}
                title={pairAgainWhy}
                onClick={onPairAgain}
              >
                Pair again
              </Button>
            </>
          )}
          <IconButton
            icon={<Icon name="trash-2" size={14} />}
            label={`Remove ${device.name}`}
            size="sm"
            disabled={holder !== null || removing}
            title={holder === null ? undefined : removeHeldWords(holder.title)}
            onClick={onRemove}
          />
        </div>
      )}
    </li>
  );
}

/** Rename in place: at most 60 characters, Save and Cancel. */
function RenameField({
  device,
  saving,
  onSave,
  onCancel,
}: {
  readonly device: ProjectDevice;
  readonly saving: boolean;
  readonly onSave: (name: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState(device.name);
  const trimmed = name.trim();
  return (
    <form
      className="project-devices-rename"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== "" && !saving) onSave(trimmed);
      }}
    >
      <Input
        aria-label={`Name of ${device.name}`}
        size="sm"
        value={name}
        maxLength={PROJECT_DEVICE_NAME_MAX_LENGTH}
        disabled={saving}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" size="sm" loading={saving} disabled={trimmed === ""}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
