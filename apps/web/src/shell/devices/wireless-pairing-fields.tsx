import { pairWirelessDeviceSchema, type PairWirelessDevice } from "@the-office/contracts";
import { Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { PAIR_WIRELESS_ERRORS, PAIR_WIRELESS_HINTS } from "./device-words.ts";
import "./devices.css";

/** What the user typed, each field as text. */
export interface WirelessPairingFields {
  readonly address: string;
  readonly port: string;
  readonly pairingPort: string;
  readonly pairingCode: string;
}

export type WirelessPairingErrors = Partial<Record<keyof WirelessPairingFields, string>>;

export const NO_WIRELESS_PAIRING_FIELDS: WirelessPairingFields = {
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
  const port = phonePortOf(fields.port);
  if (typeof port === "string") errors.port = port;
  const pairingPort = phonePortOf(fields.pairingPort);
  if (typeof pairingPort === "string") errors.pairingPort = pairingPort;
  const pairingCode = fields.pairingCode.replace(/\s/g, "");
  if (pairingCode === "") errors.pairingCode = PAIR_WIRELESS_ERRORS.noPairingCode;
  else if (!/^\d{6}$/.test(pairingCode)) errors.pairingCode = PAIR_WIRELESS_ERRORS.badPairingCode;
  if (typeof port === "string" || typeof pairingPort === "string" || Object.keys(errors).length > 0)
    return { errors };
  return { pairing: { address, port, pairingPort, pairingCode } };
}

/** A port on the phone as a number, or why it isn't one. */
export function phonePortOf(text: string): number | string {
  const trimmed = text.trim();
  if (trimmed === "") return PAIR_WIRELESS_ERRORS.noPort;
  if (!/^\d{1,5}$/.test(trimmed)) return PAIR_WIRELESS_ERRORS.badPort;
  const port = Number(trimmed);
  return port >= 1 && port <= 65_535 ? port : PAIR_WIRELESS_ERRORS.badPort;
}

/** The four fields' text and errors, held for one pairing window. */
export interface WirelessPairingDraft {
  readonly fields: WirelessPairingFields;
  readonly errors: WirelessPairingErrors;
  readonly setField: (name: keyof WirelessPairingFields, value: string) => void;
  /**
   * The pairing to send, its code already emptied from the field, as a code works once; undefined
   * when a field is wrong, each one's words then shown under it.
   */
  readonly take: () => PairWirelessDevice | undefined;
  /** Empties the Pairing code field. */
  readonly clearCode: () => void;
}

export function useWirelessPairingDraft(
  first: Partial<WirelessPairingFields> = {},
): WirelessPairingDraft {
  const [fields, setFields] = useState<WirelessPairingFields>({
    ...NO_WIRELESS_PAIRING_FIELDS,
    ...first,
  });
  const [errors, setErrors] = useState<WirelessPairingErrors>({});
  return {
    fields,
    errors,
    setField: (name, value) => {
      setFields((now) => ({ ...now, [name]: value }));
      if (errors[name] !== undefined) setErrors((now) => ({ ...now, [name]: undefined }));
    },
    take: () => {
      const made = wirelessPairingOf(fields);
      if ("errors" in made) {
        setErrors(made.errors);
        return undefined;
      }
      setErrors({});
      // The code works once: it leaves the field as it is sent.
      setFields((now) => ({ ...now, pairingCode: "" }));
      return made.pairing;
    },
    clearCode: () => setFields((now) => ({ ...now, pairingCode: "" })),
  };
}

/**
 * The fields of pairing a phone over wireless debugging (spec screens/task-page.md, "Devices"):
 * its IP address and Port from its Wireless debugging screen, the Pairing port and Pairing code
 * from "Pair device with pairing code", each with its hint and its error.
 */
export function WirelessPairingInputs({
  draft,
  disabled,
}: {
  readonly draft: WirelessPairingDraft;
  readonly disabled: boolean;
}): ReactNode {
  const field = (name: keyof WirelessPairingFields) => ({
    name,
    value: draft.fields[name],
    error: draft.errors[name],
    hint: PAIR_WIRELESS_HINTS[name],
    disabled,
    onChange: (event: { readonly target: { readonly value: string } }) =>
      draft.setField(name, event.target.value),
  });
  return (
    <>
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
    </>
  );
}
