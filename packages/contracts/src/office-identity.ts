import { z } from "zod";

/** The Office ssh key's public half, in the `ssh-ed25519 <key> <comment>` form a host takes. */
export const officeSshKeySchema = z.object({ publicKey: z.string().min(1) });
export type OfficeSshKey = z.infer<typeof officeSshKeySchema>;

/** ssh's own port, which a host is reached on unless it names another. */
export const SSH_PORT = 22;

/** A host name or an address; never one starting with `-`, which ssh's programs read as an option. */
const hostSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:][A-Za-z0-9_.:-]*$/, "must be a host name or an address");
const portSchema = z.number().int().min(1).max(65_535);

/** A host reached over ssh: its name or address and the port its ssh listens on. */
export const sshHostSchema = z.object({ host: hostSchema, port: portSchema.default(SSH_PORT) });
export type SshHost = z.infer<typeof sshHostSchema>;

/** A Trusted host: one whose key The Office's ssh accepts, with the fingerprints of those keys. */
export const trustedHostSchema = z.object({
  host: z.string().min(1),
  port: portSchema,
  fingerprints: z.array(z.string().min(1)),
  /** Trusted from GitHub's published list rather than by the user's confirmation. */
  fromGitHub: z.boolean(),
});
export type TrustedHost = z.infer<typeof trustedHostSchema>;

/**
 * An Unconfirmed host: one an Office git command was refused for because its key isn't confirmed
 * yet.
 */
export const unconfirmedHostSchema = z.object({ host: z.string().min(1), port: portSchema });
export type UnconfirmedHost = z.infer<typeof unconfirmedHostSchema>;

/** The Office's own known hosts: its Trusted hosts and its Unconfirmed hosts. */
export const knownHostsSchema = z.object({
  trusted: z.array(trustedHostSchema),
  unconfirmed: z.array(unconfirmedHostSchema),
});
export type KnownHosts = z.infer<typeof knownHostsSchema>;

/** A key a host presents now, for the user to compare its fingerprint with the host's own. */
export const hostKeySchema = z.object({
  /** Its algorithm, as `ssh-ed25519`. */
  type: z.string().min(1),
  /** As `ssh-keygen -l` prints it: `SHA256:` and the key's base64 digest. */
  fingerprint: z.string().min(1),
});
export type HostKey = z.infer<typeof hostKeySchema>;

/** The keys a scanned host presents; none when nothing answered on its ssh port. */
export const scannedHostSchema = z.object({
  host: z.string().min(1),
  port: portSchema,
  keys: z.array(hostKeySchema),
});
export type ScannedHost = z.infer<typeof scannedHostSchema>;

/** The user confirming that the host's key with `fingerprint` is the host's own. */
export const hostKeyConfirmationSchema = sshHostSchema.extend({
  fingerprint: z.string().trim().min(1),
});
export type HostKeyConfirmation = z.infer<typeof hostKeyConfirmationSchema>;
