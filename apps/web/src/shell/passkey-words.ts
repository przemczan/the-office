import type { Passkey, WayUnavailableReason } from "@the-office/contracts";

/** Why passkeys don't work at the address the page is on, shared by the sign-in page and the account. */
const UNAVAILABLE_WORDS: Readonly<Record<WayUnavailableReason, string>> = {
  "ip-address": "Passkeys don't work at an IP address.",
  "needs-https-domain": "Passkeys need The Office's public address: a domain name over HTTPS.",
};

export function passkeysUnavailableWords(reason: WayUnavailableReason): string {
  return UNAVAILABLE_WORDS[reason];
}

/** The link to the address passkeys work at instead: "Open localhost:4310". */
export function elsewhereWords(elsewhere: string): string {
  return `Open ${new URL(elsewhere).host}`;
}

/** The same page at the address passkeys work at. */
export function elsewhereHref(elsewhere: string, path: string): string {
  return new URL(path, elsewhere).href;
}

/** Where a passkey works, as its row says it: "Works at localhost", "Use it at …". */
export function passkeyAtWords(passkey: Passkey): string {
  switch (passkey.at) {
    case "this-address":
      return `Works at ${passkey.rpId}`;
    case "other-address":
      return `Use it at ${passkey.rpId}`;
    case "old-address":
      return `Added at ${passkey.rpId}, no longer The Office's address: it can't sign in.`;
  }
}
