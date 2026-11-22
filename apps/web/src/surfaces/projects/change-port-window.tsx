import { useMutation } from "@tanstack/react-query";
import type { Project, ProjectDevice } from "@the-office/contracts";
import { Button, Dialog, Input } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { changeProjectDevice } from "../../api/devices.ts";
import { DevicesNote } from "../../shell/devices/device-parts.tsx";
import { phonePortOf } from "../../shell/devices/wireless-pairing-fields.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import {
  changePortTitle,
  DEVICE_NOT_SAVED,
  noPairingNeededWords,
  PORT_HINT,
  portSavedToastWords,
} from "./devices-words.ts";

/**
 * Change Port (spec screens/project-page.md, "Devices"): a phone over wireless debugging's new Port,
 * as turning wireless debugging off and on changes it; no pairing, as the phone trusts the
 * Project's key.
 */
export function ChangePortWindow({
  project,
  device,
  onClose,
}: {
  readonly project: Project;
  readonly device: ProjectDevice;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const showToast = useToast();
  const [port, setPort] = useState(device.port === null ? "" : String(device.port));
  const [error, setError] = useState<string>();
  const saving = useMutation({
    mutationFn: (next: number) => changeProjectDevice(device.id, { port: next }),
    onSuccess: (saved) => {
      showToast(portSavedToastWords(saved.name));
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title={changePortTitle(device.name)}
      onClose={onClose}
      actions={
        <Button type="submit" form={formId} loading={saving.isPending}>
          Save
        </Button>
      }
    >
      <form
        id={formId}
        className="devices-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (saving.isPending) return;
          const next = phonePortOf(port);
          if (typeof next === "string") {
            setError(next);
            return;
          }
          setError(undefined);
          saving.mutate(next);
        }}
      >
        {saving.error && <RefusalAlert title={DEVICE_NOT_SAVED} error={saving.error} />}
        <Input
          label="Port"
          inputMode="numeric"
          autoComplete="off"
          value={port}
          error={error}
          hint={PORT_HINT}
          disabled={saving.isPending}
          onChange={(event) => {
            setPort(event.target.value);
            setError(undefined);
          }}
        />
        <DevicesNote>{noPairingNeededWords(project)}</DevicesNote>
      </form>
    </Dialog>
  );
}
