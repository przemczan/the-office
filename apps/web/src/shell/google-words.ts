import type { WayUnavailableReason } from "@the-office/contracts";

/**
 * Why Continue with Google doesn't work at the address the page is on, shared by the sign-in page
 * and the account: Google sends the browser back only to `localhost` or an HTTPS domain.
 */
const UNAVAILABLE_WORDS: Readonly<Record<WayUnavailableReason, string>> = {
  "ip-address": "Continue with Google doesn't work at an IP address.",
  "needs-https-domain":
    "Continue with Google works only at localhost or The Office's public address over HTTPS.",
};

export function googleUnavailableWords(reason: WayUnavailableReason): string {
  return UNAVAILABLE_WORDS[reason];
}
