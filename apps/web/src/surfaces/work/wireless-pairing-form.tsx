import { pairWirelessDeviceSchema, type PairWirelessDevice } from "@the-office/contracts";
import { Button, Dialog, Icon, Input } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { usePairWirelessDevice } from "../../api/devices.ts";
import { useToast } from "../../shell/toasts.tsx";
import { ConnectRefused } from "./connect-refused.tsx";
import {
  pairingToastWords,
  PAIR_WIRELESS,
  PAIR_WIRELESS_ERRORS,
  PAIR_WIRELESS_HINTS,
  PAIRING_STARTS_RUN_ENVIRONMENT,
  wirelessPhoneWords,
} from "./device-words.ts";

/** What the user typed, each field as text. */
export interface WirelessPairingFields {
  readonly address: string;
  readonly port: string;
  readonly pairingPort: string;
  readonly pairingCode: string;
}

export type WirelessPairingErrors = Partial<Record<keyof WirelessPairingFields, string>>;

const NO_FIELDS: WirelessPairingFields = {
  address: "",
  port: "",
  pairingPort: "",
  pairingCode: "",
};

/**
 * The pairing the fields make, or what is wrong with each, in words. The service refuses the
 * addresses no phone has (loopback, link-local and the like) itself.
 */
export function wirelessPairingOf(
  fields: WirelessPairingFields,
): { readonly pairing: PairWirelessDevice } | { readonly errors: WirelessPairingErrors } {
  const errors: WirelessPairingErrors = {};
  const address = fields.address.trim();
  if (address === "") errors.address = PAIR_WIRELESS_ERRORS.noAddress;
  else if (!pairWirelessDeviceSchema.shape.address.safeParse(address).success)
    errors.address = PAIR_WIRELESS_ERRORS.badAddress;
  const port = portOf(fields.port);
  if (typeof port === "string") errors.port = port;
  const pairingPort = portOf(fields.pairingPort);
  if (typeof pairingPort === "string") errors.pairingPort = pairingPort;
  const pairingCode = fields.pairingCode.replace(/\s/g, "");
  if (pairingCode === "") errors.pairingCode = PAIR_WIRELESS_ERRORS.noPairingCode;
  else if (!/^\d{6}$/.test(pairingCode)) errors.pairingCode = PAIR_WIRELESS_ERRORS.badPairingCode;
  if (typeof port === "string" || typeof pairingPort === "string" || Object.keys(errors).length > 0)
    return { errors };
  return { pairing: { address, port, pairingPort, pairingCode } };
}

/** A port as a number, or why it isn't one. */
function portOf(text: string): number | string {
  const trimmed = text.trim();
  if (trimmed === "") return PAIR_WIRELESS_ERRORS.noPort;
  if (!/^\d{1,5}$/.test(trimmed)) return PAIR_WIRELESS_ERRORS.badPort;
  const port = Number(trimmed);
  return port >= 1 && port <= 65_535 ? port : PAIR_WIRELESS_ERRORS.badPort;
}

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
  const [fields, setFields] = useState(NO_FIELDS);
  const [errors, setErrors] = useState<WirelessPairingErrors>({});
  const [sentAddress, setSentAddress] = useState("");
  const pairing = usePairWirelessDevice(taskId);
  const field = (name: keyof WirelessPairingFields) => ({
    name,
    value: fields[name],
    error: errors[name],
    hint: PAIR_WIRELESS_HINTS[name],
    disabled: pairing.isPending,
    onChange: (event: { readonly target: { readonly value: string } }) => {
      const value = event.target.value;
      setFields((now) => ({ ...now, [name]: value }));
      if (errors[name] !== undefined) setErrors((now) => ({ ...now, [name]: undefined }));
    },
  });
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
          const made = wirelessPairingOf(fields);
          if ("errors" in made) {
            setErrors(made.errors);
            return;
          }
          setErrors({});
          setSentAddress(made.pairing.address);
          // The code works once: it leaves the field as it is sent.
          setFields((now) => ({ ...now, pairingCode: "" }));
          pairing.mutate(made.pairing, {
            onSuccess: () => {
              showToast(pairingToastWords(made.pairing.address));
              onClose();
            },
            onError: () => setFields((now) => ({ ...now, pairingCode: "" })),
          });
        }}
      >
        {pairing.error && (
          <ConnectRefused error={pairing.error} deviceName={wirelessPhoneWords(sentAddress)} />
        )}
        <div className="wireless-pairing-pair">
          <Input
            label="IP address"
            placeholder="192.168.1.20"
            autoComplete="off"
            spellCheck={false}
            {...field("address")}
          />
          <Input label="Port" inputMode="numeric" autoComplete="off" {...field("port")} />
        </div>
        <div className="wireless-pairing-pair">
          <Input
            label="Pairing port"
            inputMode="numeric"
            autoComplete="off"
            {...field("pairingPort")}
          />
          <Input
            label="Pairing code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            {...field("pairingCode")}
          />
        </div>
        <p className="devices-note">
          <Icon name="info" size={14} />
          {PAIRING_STARTS_RUN_ENVIRONMENT}
        </p>
      </form>
    </Dialog>
  );
}
