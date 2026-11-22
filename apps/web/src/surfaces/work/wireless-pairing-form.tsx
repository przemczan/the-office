import { Button, Dialog, Icon } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { usePairWirelessDevice } from "../../api/devices.ts";
import {
  useWirelessPairingDraft,
  WirelessPairingInputs,
} from "../../shell/devices/wireless-pairing-fields.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { ConnectRefused } from "./connect-refused.tsx";
import {
  pairingToastWords,
  PAIR_WIRELESS,
  PAIRING_STARTS_RUN_ENVIRONMENT,
  wirelessPhoneWords,
} from "./device-words.ts";

/**
 * Pair over wireless debugging (spec screens/task-page.md, "Devices"; 2.13): the phone's address
 * and port from its Wireless debugging screen, the pairing port and code from "Pair device with
 * pairing code". The code leaves the field as Pair sends it, and the window closes once the
 * record is made; a refusal shows in the window, in the service's words.
 */
export function WirelessPairingForm({
  taskId,
  onClose,
}: {
  readonly taskId: string;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const showToast = useToast();
  const draft = useWirelessPairingDraft();
  const [sentAddress, setSentAddress] = useState("");
  const pairing = usePairWirelessDevice(taskId);
  return (
    <Dialog
      size="medium"
      title={PAIR_WIRELESS}
      onClose={onClose}
      actions={
        <Button type="submit" form={formId} loading={pairing.isPending}>
          Pair
        </Button>
      }
    >
      <form
        id={formId}
        className="work-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pairing.isPending) return;
          const made = draft.take();
          if (made === undefined) return;
          setSentAddress(made.address);
          pairing.mutate(made, {
            onSuccess: () => {
              showToast(pairingToastWords(made.address));
              onClose();
            },
            onError: draft.clearCode,
          });
        }}
      >
        {pairing.error && (
          <ConnectRefused error={pairing.error} deviceName={wirelessPhoneWords(sentAddress)} />
        )}
        <WirelessPairingInputs draft={draft} disabled={pairing.isPending} />
        <p className="devices-note">
          <Icon name="info" size={14} />
          {PAIRING_STARTS_RUN_ENVIRONMENT}
        </p>
      </form>
    </Dialog>
  );
}
