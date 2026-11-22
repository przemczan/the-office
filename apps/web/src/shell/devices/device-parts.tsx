import { Icon, type MenuItem } from "@the-office/ui";
import type { ReactNode } from "react";
import { registerDeviceTransport, type DeviceTransportProvider } from "../../api/device-relay.ts";
import { serialUsbTransport } from "../../api/device-transports/serial-usb.ts";
import { androidUsbTransport } from "./android-usb/webusb-adb.ts";
import { DEVICE_KIND_WORDS } from "./device-words.ts";
import "./devices.css";

let registered = false;

/**
 * Registers every kind this build reaches in the browser, once however many sections ask: an
 * Android phone with WebUSB and a serial board with Web Serial (spec 2.13). Tests register their
 * own on top, as the last one registered for a kind is the one used.
 */
export function registerBrowserDeviceTransports(): void {
  if (registered) return;
  registered = true;
  registerDeviceTransport(androidUsbTransport());
  registerDeviceTransport(serialUsbTransport());
}

/**
 * A USB kind as a menu's choice: its name, or, where this browser can't reach it, greyed with why
 * under its name ("Needs Chrome or Edge", "Needs The Office over HTTPS or localhost").
 */
export function usbKindChoice(
  provider: DeviceTransportProvider,
  onSelect: () => void,
  label: ReactNode = DEVICE_KIND_WORDS[provider.kind],
): MenuItem {
  const unavailable = provider.unavailable;
  return unavailable === undefined
    ? { label, onSelect }
    : {
        disabled: true,
        label: (
          <span className="devices-kind">
            {label}
            <span className="devices-kind-why">{unavailable}</span>
          </span>
        ),
      };
}

/** A quiet note under a devices list, with its icon. */
export function DevicesNote({
  icon = "info",
  children,
}: {
  readonly icon?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <p className="devices-note">
      <Icon name={icon} size={14} />
      {children}
    </p>
  );
}
