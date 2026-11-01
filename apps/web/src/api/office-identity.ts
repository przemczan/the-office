import { queryOptions } from "@tanstack/react-query";
import {
  knownHostsSchema,
  officeSshKeySchema,
  scannedHostSchema,
  type HostKeyConfirmation,
  type KnownHosts,
  type ScannedHost,
  type SshHost,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";

const KNOWN_HOSTS = ["office-identity", "known-hosts"] as const;

export const officeIdentityQueries = {
  /** The Office ssh key's public half; the service makes the key first if it has none. */
  sshKey: () =>
    queryOptions({
      queryKey: ["office-identity", "ssh-key"],
      queryFn: ({ signal }) => getFromApi("/office-identity/ssh-key", officeSshKeySchema, signal),
    }),
  /**
   * The Trusted hosts and the Unconfirmed hosts. No event says a host became unconfirmed, so it is
   * read again whenever the page is focused.
   */
  knownHosts: () =>
    queryOptions({
      queryKey: KNOWN_HOSTS,
      queryFn: ({ signal }) => getFromApi("/office-identity/known-hosts", knownHostsSchema, signal),
    }),
};

/** The keys the host presents now, for the user to compare with the host's own fingerprints. */
export function scanHost(host: SshHost): Promise<ScannedHost> {
  return sendToApi("POST", "/office-identity/known-hosts/scan", host, scannedHostSchema);
}

/** Trusts the host's key with the fingerprint the user confirmed; refused with the reason. */
export function confirmFingerprint(confirmation: HostKeyConfirmation): Promise<KnownHosts> {
  return sendToApi("POST", "/office-identity/known-hosts", confirmation, knownHostsSchema);
}
