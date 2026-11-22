/**
 * The users of The Office, which the Users module keeps; the composition root binds it. Each one
 * not removed receives the Notifications their own routing gives a channel.
 */
export abstract class OfficeUsers {
  /** The users not removed. */
  abstract list(): Promise<readonly { readonly id: string }[]>;
}
