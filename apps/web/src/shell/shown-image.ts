import { useState } from "react";

export interface ShownImage {
  /** Undefined when there is no image to show, or it couldn't be loaded: draw the fallback. */
  readonly address: string | undefined;
  readonly onError: () => void;
}

/** The image at `address` until it fails to load; another image, at its own address, gets a try. */
export function useShownImage(address: string | undefined): ShownImage {
  const [failedAddress, setFailedAddress] = useState<string>();
  return {
    address: address === failedAddress ? undefined : address,
    onError: () => setFailedAddress(address),
  };
}
