import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PairWirelessDevice, Project, ProjectDevice } from "@the-office/contracts";
import { Alert, Button, Dialog, Icon } from "@the-office/ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { addProjectDevice, deviceQueries, pairProjectDevice } from "../../api/devices.ts";
import { DevicesNote } from "../../shell/devices/device-parts.tsx";
import {
  useWirelessPairingDraft,
  WirelessPairingInputs,
} from "../../shell/devices/wireless-pairing-fields.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import {
  ADD_WIRELESS_TITLE,
  pairAgainTitle,
  pairedToastWords,
  pairingEnvironmentWords,
  pairingProgressOf,
  PAIRING_STEP_WORDS,
  PHONE_NOT_PAIRED,
} from "./devices-words.ts";

/**
 * Add a phone over wireless debugging, or Pair <name> again (spec screens/project-page.md, "Add a
 * device"; 2.13, "Pairing a Project device"): the Task page's four fields and checks, Pair emptying
 * the code as it sends. The device is added Not paired and paired in a pairing environment; the
 * window follows its `pairingStep` through the Project's devices, which `project-device.changed`
 * reads again, closes with a toast once Paired, and keeps a failure in its words for Pair to try
 * again with a new code.
 */
export function DevicePairingWindow({
  project,
  device,
  onClose,
}: {
  readonly project: Project;
  /** Pair again's device; none to add one. */
  readonly device?: ProjectDevice;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const listKey = deviceQueries.ofProject(project.id).queryKey;
  const draft = useWirelessPairingDraft(
    device === undefined
      ? {}
      : { address: device.address ?? "", port: device.port === null ? "" : String(device.port) },
  );
  // The device this window paired, once the service took the pairing.
  const [pairedId, setPairedId] = useState<string>();
  const listed = useQuery(deviceQueries.ofProject(project.id)).data?.devices;
  const followed = listed?.find(({ id }) => id === pairedId);
  const progress = followed === undefined ? undefined : pairingProgressOf(followed);
  const pairing = useMutation({
    mutationFn: (sent: PairWirelessDevice) => {
      const again = pairedId ?? device?.id;
      return again === undefined
        ? addProjectDevice(project.id, { kind: "android-wireless", ...sent })
        : pairProjectDevice(again, sent);
    },
    onSuccess: (answered) => {
      // The answer leads the list until its event reads it again, so an earlier ending isn't shown.
      queryClient.setQueryData(listKey, (list) =>
        list === undefined
          ? list
          : {
              devices: list.devices.some(({ id }) => id === answered.id)
                ? list.devices.map((each) => (each.id === answered.id ? answered : each))
                : [...list.devices, answered],
            },
      );
      setPairedId(answered.id);
    },
    onError: draft.clearCode,
  });
  const paired = progress?.kind === "paired" ? followed : undefined;
  const told = useRef(false);
  useEffect(() => {
    if (paired === undefined || told.current) return;
    told.current = true;
    showToast(pairedToastWords(paired.name, project.name));
    onClose();
  }, [paired, project.name, showToast, onClose]);
  const busy = pairing.isPending || progress?.kind === "pairing";
  return (
    <Dialog
      size="medium"
      title={device === undefined ? ADD_WIRELESS_TITLE : pairAgainTitle(device.name)}
      onClose={onClose}
      actions={
        <Button type="submit" form={formId} loading={busy}>
          Pair
        </Button>
      }
    >
      <form
        id={formId}
        className="devices-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const made = draft.take();
          if (made !== undefined) pairing.mutate(made);
        }}
      >
        {pairing.error && <RefusalAlert title={PHONE_NOT_PAIRED} error={pairing.error} />}
        {progress?.kind === "failed" && !pairing.isPending && (
          <Alert tone="danger" title={PHONE_NOT_PAIRED}>
            <p className="devices-refusal">{progress.problem}</p>
          </Alert>
        )}
        <WirelessPairingInputs draft={draft} disabled={busy} />
        <DevicesNote>{pairingEnvironmentWords(project.baseBranch)}</DevicesNote>
        {progress?.kind === "pairing" && (
          <ul className="devices-pairing-steps" role="status" aria-label="Pairing">
            {progress.passed.map((step) => (
              <li key={step} className="devices-pairing-step" data-passed="">
                <Icon name="check" size={14} />
                {PAIRING_STEP_WORDS[step]}
              </li>
            ))}
            <li className="devices-pairing-step">
              <Icon name="loader" size={14} />
              {PAIRING_STEP_WORDS[progress.at]}
            </li>
          </ul>
        )}
      </form>
    </Dialog>
  );
}
