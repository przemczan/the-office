import type { ConnectedDeviceState } from "@the-office/contracts";
import type { BadgeProps } from "@the-office/ui";

/** Each state's name (spec 2.13, "States"). */
export const DEVICE_STATE_WORDS: Readonly<Record<ConnectedDeviceState, string>> = {
  connecting: "Connecting",
  connected: "Connected",
  "waiting-for-run-environment": "Waiting for the run environment",
  disconnected: "Disconnected",
};

export const DEVICE_STATE_TONES: Readonly<
  Record<ConnectedDeviceState, NonNullable<BadgeProps["tone"]>>
> = {
  connecting: "info",
  connected: "success",
  "waiting-for-run-environment": "warning",
  disconnected: "neutral",
};
